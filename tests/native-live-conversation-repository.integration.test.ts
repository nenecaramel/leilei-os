import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
  nativeLiveBackgroundModelJobs,
  nativeLiveProviderSessionCleanups,
  nativeLiveTurnPreparations,
  runtimeEffects,
  runtimeProactivityWakes,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import { DrizzleNativeLiveConversationRepository } from "../src/domains/conversation/native-live-conversation-repository.js";
import { DrizzleNativeLiveCurrentPathReader } from "../src/domains/conversation/native-live-current-path-read-repository.js";
import { NativeLiveConversationService } from "../src/domains/conversation/native-live-conversation-service.js";
import {
  DrizzleNativeLiveBackgroundModelQueueRepository,
  NativeLiveBackgroundModelQueueService,
} from "../src/domains/bridge/native-live-background-model-queue.js";
import { DrizzleProactivityWakeRepository } from "../src/domains/runtime/proactivity-wake-repository.js";
import { DrizzleRuntimeEffectRepository } from "../src/domains/runtime/runtime-effect-repository.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_CONVERSATION_DATABASE_TEST === "1";

test(
  "native live conversation persistence keeps immutable branches, exact checkpoints, tenant isolation, and assistant atomicity",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, {
      ssl: false,
      createClient: (url, maxConnections, ssl) =>
        postgres(url, {
          max: maxConnections,
          prepare: false,
          ssl,
          connect_timeout: 15,
          idle_timeout: 60,
        }),
    });
    const suffix = crypto.randomUUID();
    const createdUsers = await database.db
      .insert(users)
      .values([
        {
          email: `native-live-a-${suffix}@example.com`,
          displayName: "Native Live A",
        },
        {
          email: `native-live-b-${suffix}@example.com`,
          displayName: "Native Live B",
        },
      ])
      .returning({ id: users.id });
    assert.equal(createdUsers.length, 2);
    const userA = createdUsers[0]!.id;
    const userB = createdUsers[1]!.id;

    t.after(async () => {
      try {
        await database.db
          .delete(conversations)
          .where(eq(conversations.userId, userA));
        await database.db.delete(users).where(eq(users.id, userA));
        await database.db.delete(users).where(eq(users.id, userB));
      } finally {
        await database.close();
      }
    });

    const repository = new DrizzleNativeLiveConversationRepository(database.db);
    const service = new NativeLiveConversationService(repository);
    const currentPathReader = new DrizzleNativeLiveCurrentPathReader(database.db);

    const conversation = await service.createConversation({
      userId: userA,
      title: "Native live test",
    });
    assert.equal(conversation.currentHeadMessageId, null);

    const userMessage = await service.appendUserMessage({
      userId: userA,
      conversationId: conversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "hello" }],
    });

    const first = await service.completeAssistantTurn({
      userId: userA,
      conversationId: conversation.id,
      parentMessageId: userMessage.id,
      blocks: [{ kind: "text", text: "first" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "frozen-session-1",
        providerCheckpointId: "checkpoint-1",
      },
    });

    await assert.rejects(
      service.setCurrentHead({
        userId: userA,
        conversationId: conversation.id,
        messageId: userMessage.id,
      }),
      /not found/i,
    );

    await assert.rejects(
      service.appendUserMessage({
        userId: userA,
        conversationId: conversation.id,
        parentMessageId: userMessage.id,
        blocks: [{ kind: "text", text: "invalid same-role child" }],
      }),
      /not found/i,
    );

    const second = await service.completeAssistantTurn({
      userId: userA,
      conversationId: conversation.id,
      parentMessageId: userMessage.id,
      blocks: [{ kind: "text", text: "retry sibling" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "frozen-session-2",
        providerCheckpointId: "checkpoint-2",
      },
    });

    const stored = await service.getConversation({
      userId: userA,
      conversationId: conversation.id,
    });
    assert.ok(stored);
    assert.equal(stored.messages.length, 3);
    assert.equal(stored.currentHeadMessageId, second.message.id);

    const secondHeadPage = await service.listConversationPage({
      userId: userA,
      limit: 10,
    });
    const secondHeadSummary = secondHeadPage.conversations.find(
      (item) => item.id === conversation.id,
    );
    assert.equal(
      secondHeadSummary?.lastMessageAt,
      second.message.createdAt,
    );

    const renamed = await service.renameConversation({
      userId: userA,
      conversationId: conversation.id,
      title: "Renamed without touching message time",
    });
    assert.equal(renamed?.lastMessageAt, second.message.createdAt);
    assert.notEqual(renamed?.updatedAt, second.message.createdAt);

    const secondBranchPath = await currentPathReader.readCurrentPath({
      userId: userA,
      conversationId: conversation.id,
      limit: 100,
    });
    assert.ok(secondBranchPath);
    assert.equal(secondBranchPath.truncated, false);
    assert.equal(secondBranchPath.syncToken, `head:${second.message.id}`);
    assert.deepEqual(
      secondBranchPath.messages.map((message) => message.id),
      [userMessage.id, second.message.id],
    );
    assert.deepEqual(
      secondBranchPath.messages.map((message) =>
        message.blocks.map((block) => block.text)),
      [["hello"], ["retry sibling"]],
    );

    await service.setCurrentHead({
      userId: userA,
      conversationId: conversation.id,
      messageId: first.message.id,
    });
    const switched = await service.getConversation({
      userId: userA,
      conversationId: conversation.id,
    });
    assert.equal(switched?.currentHeadMessageId, first.message.id);

    const firstHeadPage = await service.listConversationPage({
      userId: userA,
      limit: 10,
    });
    assert.equal(
      firstHeadPage.conversations.find(
        (item) => item.id === conversation.id,
      )?.lastMessageAt,
      first.message.createdAt,
    );

    const firstBranchPath = await currentPathReader.readCurrentPath({
      userId: userA,
      conversationId: conversation.id,
      limit: 100,
    });
    assert.ok(firstBranchPath);
    assert.equal(firstBranchPath.truncated, false);
    assert.equal(firstBranchPath.syncToken, `head:${first.message.id}`);
    assert.deepEqual(
      firstBranchPath.messages.map((message) => message.id),
      [userMessage.id, first.message.id],
    );
    assert.deepEqual(
      firstBranchPath.messages.map((message) =>
        message.blocks.map((block) => block.text)),
      [["hello"], ["first"]],
    );

    const narrowFirstBranchPath = await currentPathReader.readCurrentPath({
      userId: userA,
      conversationId: conversation.id,
      limit: 1,
    });
    assert.ok(narrowFirstBranchPath);
    assert.equal(narrowFirstBranchPath.truncated, true);
    assert.deepEqual(
      narrowFirstBranchPath.messages.map((message) => message.id),
      [first.message.id],
    );

    const firstCheckpoint = await service.getProviderCheckpointForHead({
      userId: userA,
      conversationId: conversation.id,
      canonicalMessageId: first.message.id,
    });
    const secondCheckpoint = await service.getProviderCheckpointForHead({
      userId: userA,
      conversationId: conversation.id,
      canonicalMessageId: second.message.id,
    });
    assert.equal(firstCheckpoint?.providerSessionId, "frozen-session-1");
    assert.equal(secondCheckpoint?.providerSessionId, "frozen-session-2");

    const crossUser = await service.getConversation({
      userId: userB,
      conversationId: conversation.id,
    });
    assert.equal(crossUser, null);
    assert.equal(
      await currentPathReader.readCurrentPath({
        userId: userB,
        conversationId: conversation.id,
        limit: 100,
      }),
      null,
    );
    await assert.rejects(
      service.setCurrentHead({
        userId: userB,
        conversationId: conversation.id,
        messageId: first.message.id,
      }),
      /not found/i,
    );

    const failedUserMessage = await service.appendUserMessage({
      userId: userA,
      conversationId: conversation.id,
      parentMessageId: first.message.id,
      blocks: [{ kind: "text", text: "cause checkpoint failure" }],
    });

    const beforeFailure = await database.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));

    await assert.rejects(
      service.completeAssistantTurn({
        userId: userA,
        conversationId: conversation.id,
        parentMessageId: failedUserMessage.id,
        blocks: [{ kind: "text", text: "must roll back" }],
        checkpoint: {
          provider: "claude_code",
          providerSessionId: "",
        },
      }),
    );

    const afterFailure = await database.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));
    assert.equal(afterFailure.length, beforeFailure.length);

    const heads = await database.db
      .select({ currentHeadMessageId: conversations.currentHeadMessageId })
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    assert.equal(heads[0]?.currentHeadMessageId, first.message.id);

    const checkpoints = await database.db
      .select({ id: conversationProviderSessionCheckpoints.id })
      .from(conversationProviderSessionCheckpoints)
      .where(
        eq(
          conversationProviderSessionCheckpoints.conversationId,
          conversation.id,
        ),
      );
    assert.equal(checkpoints.length, 2);
  },
);


test(
  "native live Archive / Restore / true Delete preserves Mind while deleting conversation-owned data",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, {
      ssl: false,
      createClient: (url, maxConnections, ssl) =>
        postgres(url, {
          max: maxConnections,
          prepare: false,
          ssl,
          connect_timeout: 15,
          idle_timeout: 60,
        }),
    });
    let userId: string | null = null;
    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(nativeLiveBackgroundModelJobs)
            .where(eq(nativeLiveBackgroundModelJobs.userId, userId));
          await database.db
            .delete(nativeLiveProviderSessionCleanups)
            .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
          await database.db
            .delete(runtimeEffects)
            .where(eq(runtimeEffects.userId, userId));
          await database.db
            .delete(runtimeProactivityWakes)
            .where(eq(runtimeProactivityWakes.userId, userId));
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-lifecycle-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Lifecycle",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const service = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );

    const deletedConversation = await service.createConversation({
      userId,
      title: "Delete me",
    });
    const firstUser = await service.appendUserMessage({
      userId,
      conversationId: deletedConversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "first" }],
    });
    const firstAssistant = await service.completeAssistantTurn({
      userId,
      conversationId: deletedConversation.id,
      parentMessageId: firstUser.id,
      blocks: [{ kind: "text", text: "first reply" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "exclusive-delete-session",
      },
    });
    const secondUser = await service.appendUserMessage({
      userId,
      conversationId: deletedConversation.id,
      parentMessageId: firstAssistant.message.id,
      blocks: [{ kind: "text", text: "second" }],
    });
    const secondAssistant = await service.completeAssistantTurn({
      userId,
      conversationId: deletedConversation.id,
      parentMessageId: secondUser.id,
      blocks: [{ kind: "text", text: "second reply" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "shared-delete-session",
      },
    });

    const survivingConversation = await service.createConversation({
      userId,
      title: "Keep me",
    });
    const survivingUser = await service.appendUserMessage({
      userId,
      conversationId: survivingConversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "keep" }],
    });
    await service.completeAssistantTurn({
      userId,
      conversationId: survivingConversation.id,
      parentMessageId: survivingUser.id,
      blocks: [{ kind: "text", text: "keep reply" }],
      checkpoint: {
        provider: "claude_code",
        providerSessionId: "shared-delete-session",
      },
    });

    const mindStateId = crypto.randomUUID();
    await database.db.insert(runtimeSubjectStates).values({
      id: mindStateId,
      userId,
      subjectId: "G",
      kind: "memory",
      text: "Mind survives conversation deletion",
      payload: { source: "runtime" },
      scopeApplicability: "global",
      scopeConversationId: null,
      scopePathHeadMessageId: null,
      settlementStatus: "settled",
      pathStatus: "current",
      validityStatus: "valid",
      envelope: {
        authority: "derived",
        scope: {
          userId,
          subjectId: "G",
          applicability: "global",
          conversationId: null,
          pathHeadMessageId: null,
        },
      },
    });

    const exclusiveMindStateId = crypto.randomUUID();
    const scopedMindStateId = crypto.randomUUID();
    const sharedMindStateId = crypto.randomUUID();
    const survivingDriveStateId = crypto.randomUUID();
    await database.db.insert(runtimeSubjectStates).values([
      {
        id: exclusiveMindStateId,
        userId,
        subjectId: "G",
        kind: "drive",
        text: "exclusive Mind survives deleted conversation",
        payload: { source: "runtime" },
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          authority: "derived",
          scope: {
            userId,
            subjectId: "G",
            applicability: "global",
          },
          provenance: {
            sources: [{ kind: "message", id: firstUser.id }],
          },
        },
      },
      {
        id: scopedMindStateId,
        userId,
        subjectId: "G",
        kind: "thought",
        text: "conversation scoped state",
        payload: { source: "runtime" },
        scopeApplicability: "conversation",
        scopeConversationId: deletedConversation.id,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          authority: "derived",
          scope: {
            userId,
            subjectId: "G",
            applicability: "conversation",
            conversationId: deletedConversation.id,
          },
          provenance: {
            sources: [{ kind: "message", id: survivingUser.id }],
          },
        },
      },
      {
        id: sharedMindStateId,
        userId,
        subjectId: "G",
        kind: "memory",
        text: "shared memory survives with original provenance",
        payload: {
          lifecycle_v1: {
            status: "active",
            salience: 0.66,
            protected: false,
            lastDecayedAt: "2026-09-27T06:00:00.000Z",
            lastRecalledAt: "2026-09-27T07:00:00.000Z",
            archivedAt: null,
            forgottenAt: null,
          },
          recall_reinforcement_v1: {
            contributions: [
              {
                sourceMessageId: firstUser.id,
                recalledAt: "2026-09-27T06:30:00.000Z",
                currentValue: 0.08,
              },
              {
                sourceMessageId: survivingUser.id,
                recalledAt: "2026-09-27T07:00:00.000Z",
                currentValue: 0.08,
              },
            ],
          },
        },
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          authority: "derived",
          scope: {
            userId,
            subjectId: "G",
            applicability: "global",
          },
          provenance: {
            sources: [
              { kind: "message", id: firstUser.id },
              { kind: "message", id: survivingUser.id },
            ],
            causedBy: firstUser.id,
          },
        },
      },
      {
        id: survivingDriveStateId,
        userId,
        subjectId: "G",
        kind: "drive",
        text: "drive survives with original evolution payload",
        payload: {
          drive_v1: {
            reinforcementSources: [
              survivingUser.id,
              secondAssistant.message.id,
            ],
          },
        },
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          authority: "derived",
          scope: {
            userId,
            subjectId: "G",
            applicability: "global",
          },
          provenance: {
            sources: [{ kind: "message", id: survivingUser.id }],
          },
        },
      },
    ]);

    const proactivity = new DrizzleProactivityWakeRepository(
      database.db,
    );
    const wakeId = crypto.randomUUID();
    await proactivity.createOrGet({
      gate: {
        wakeId,
        userId,
        subjectId: "G",
        offeredAt: "2026-09-27T06:45:00.000Z",
        mode: "live",
        enabled: true,
        foregroundActive: false,
        outstandingEffectStatus: null,
        quietUntil: null,
        nextEligibleAt: null,
      },
      contactTarget: null,
      context: {
        version: 1,
        contextManifestId: null,
        capsule: "deleted conversation context",
        sourceConversationId: deletedConversation.id,
        sourceHeadMessageId: secondAssistant.message.id,
        sourceActivityAt: "2026-09-27T06:40:00.000Z",
      },
    });

    const backgroundQueue = new NativeLiveBackgroundModelQueueService(
      new DrizzleNativeLiveBackgroundModelQueueRepository(database.db),
    );
    const proactivityJobId = crypto.randomUUID();
    await backgroundQueue.stage({
      userId,
      subjectId: "G",
      command: {
        protocol_version: 1,
        task_id: proactivityJobId,
        task_kind: "proactivity_deliberate",
        prompt_contract_version: "delete-test-v1",
        prompt: "proactivity snapshot that must disappear",
      },
      workflow: {
        kind: "proactivity_wake",
        runId: wakeId,
        payload: {
          version: 1,
          wake_id: wakeId,
        },
      },
    });

    const effects = new DrizzleRuntimeEffectRepository(
      database.db,
    );
    const effectId = crypto.randomUUID();
    const effectWorkerId = crypto.randomUUID();
    await effects.createOrGet({
      sourceWakeId: wakeId,
      effect: {
        effectId,
        userId,
        subjectId: "G",
        decisionId: "archive-delete-effect",
        idempotencyKey: "d".repeat(64),
        effectType: "message_send",
        target: `conversation:${deletedConversation.id}`,
        payloadHash: "e".repeat(64),
        status: "pending",
        attempt: 0,
        retryable: true,
        createdAt: "2026-09-27T06:46:00.000Z",
        updatedAt: "2026-09-27T06:46:00.000Z",
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        dispatchStartedAt: null,
        observedAt: null,
        failureCode: null,
      },
      payload: { text: "pending proactive message" },
    });

    const backgroundJobId = crypto.randomUUID();
    await database.db.insert(nativeLiveBackgroundModelJobs).values({
      id: backgroundJobId,
      userId,
      subjectId: "G",
      workflowKind: "distillation",
      workflowRunId: crypto.randomUUID(),
      workflowPayload: {
        conversation_id: deletedConversation.id,
        source_head_message_id: secondUser.id,
      },
      taskKind: "distillation",
      promptContractVersion: "delete-test-v1",
      prompt: "transcript snapshot that must disappear",
      status: "pending",
    });

    const archived = await service.archiveConversation({
      userId,
      conversationId: deletedConversation.id,
    });
    assert.equal(archived.outcome, "archived");

    await assert.rejects(
      proactivity.markWaitingModel({
        userId,
        wakeId,
        modelTaskId: proactivityJobId,
      }),
      /SourceConversationInactive/,
    );
    await assert.rejects(
      backgroundQueue.stage({
        userId,
        subjectId: "G",
        command: {
          protocol_version: 1,
          task_id: crypto.randomUUID(),
          task_kind: "proactivity_deliberate",
          prompt_contract_version: "delete-test-v1",
          prompt: "must not stage while source conversation is archived",
        },
        workflow: {
          kind: "proactivity_wake",
          runId: wakeId,
          payload: {
            version: 1,
            wake_id: wakeId,
          },
        },
      }),
      /BackgroundWorkflowSourceInactive/,
    );

    assert.equal(
      await effects.reserveNext({
        userId,
        workerInstanceId: effectWorkerId,
      }),
      null,
      "Archive must pause a pending effect targeted at the conversation",
    );

    const activePage = await service.listConversationPage({
      userId,
      limit: 20,
    });
    assert.deepEqual(
      activePage.conversations.map((item) => item.id),
      [survivingConversation.id],
    );

    const archivedPage = await service.listConversationPage({
      userId,
      limit: 20,
      scope: "archived",
    });
    assert.deepEqual(
      archivedPage.conversations.map((item) => item.id),
      [deletedConversation.id],
    );

    await assert.rejects(
      service.appendUserMessage({
        userId,
        conversationId: deletedConversation.id,
        parentMessageId: null,
        blocks: [{ kind: "text", text: "must not write while archived" }],
      }),
      /not found/i,
    );

    const restored = await service.restoreConversation({
      userId,
      conversationId: deletedConversation.id,
    });
    assert.equal(restored.outcome, "restored");
    assert.equal(
      (await service.getConversation({
        userId,
        conversationId: deletedConversation.id,
      }))?.lifecycleStatus,
      "active",
    );

    const resumedEffect = await effects.reserveNext({
      userId,
      workerInstanceId: effectWorkerId,
    });
    assert.ok(resumedEffect);
    assert.equal(resumedEffect.effectId, effectId);
    await effects.releaseReservation({
      userId,
      effectId,
      workerInstanceId: effectWorkerId,
    });

    assert.equal(
      (await service.archiveConversation({
        userId,
        conversationId: deletedConversation.id,
      })).outcome,
      "archived",
    );

    const deleted = await service.deleteConversation({
      userId,
      conversationId: deletedConversation.id,
    });
    assert.equal(deleted.outcome, "deleted");
    assert.equal(
      await service.getConversation({
        userId,
        conversationId: deletedConversation.id,
      }),
      null,
    );
    assert.equal(
      (await service.getConversation({
        userId,
        conversationId: survivingConversation.id,
      }))?.id,
      survivingConversation.id,
    );

    const deletedMessages = await database.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(
        conversationMessages.conversationId,
        deletedConversation.id,
      ));
    assert.equal(deletedMessages.length, 0);

    const deletedCheckpoints = await database.db
      .select({ id: conversationProviderSessionCheckpoints.id })
      .from(conversationProviderSessionCheckpoints)
      .where(eq(
        conversationProviderSessionCheckpoints.conversationId,
        deletedConversation.id,
      ));
    assert.equal(deletedCheckpoints.length, 0);

    const background = await database.db
      .select({ id: nativeLiveBackgroundModelJobs.id })
      .from(nativeLiveBackgroundModelJobs)
      .where(eq(nativeLiveBackgroundModelJobs.id, backgroundJobId));
    assert.equal(background.length, 0);

    const deletedEffect = await database.db
      .select({ id: runtimeEffects.id })
      .from(runtimeEffects)
      .where(eq(runtimeEffects.id, effectId));
    assert.equal(deletedEffect.length, 0);

    const deletedWake = await database.db
      .select({ id: runtimeProactivityWakes.id })
      .from(runtimeProactivityWakes)
      .where(eq(runtimeProactivityWakes.id, wakeId));
    assert.equal(deletedWake.length, 0);

    const deletedProactivityJob = await database.db
      .select({ id: nativeLiveBackgroundModelJobs.id })
      .from(nativeLiveBackgroundModelJobs)
      .where(eq(nativeLiveBackgroundModelJobs.id, proactivityJobId));
    assert.equal(deletedProactivityJob.length, 0);

    const cleanups = await database.db
      .select({
        providerSessionId:
          nativeLiveProviderSessionCleanups.providerSessionId,
      })
      .from(nativeLiveProviderSessionCleanups)
      .where(eq(nativeLiveProviderSessionCleanups.userId, userId));
    assert.deepEqual(
      cleanups.map((row) => row.providerSessionId).sort(),
      ["exclusive-delete-session"],
    );

    const survivingMind = await database.db
      .select({
        id: runtimeSubjectStates.id,
        text: runtimeSubjectStates.text,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.id, mindStateId));
    assert.deepEqual(survivingMind, [{
      id: mindStateId,
      text: "Mind survives conversation deletion",
    }]);

    const preservedMind = await database.db
      .select({
        id: runtimeSubjectStates.id,
        payload: runtimeSubjectStates.payload,
        envelope: runtimeSubjectStates.envelope,
        scopeConversationId: runtimeSubjectStates.scopeConversationId,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, userId));
    const preservedById = new Map(
      preservedMind.map((state) => [state.id, state]),
    );
    assert.equal(preservedById.has(exclusiveMindStateId), true);
    assert.equal(preservedById.has(scopedMindStateId), true);

    const sharedMind = preservedById.get(sharedMindStateId);
    assert.ok(sharedMind);
    assert.deepEqual(
      (
        sharedMind.envelope.provenance as {
          sources: Array<{ kind: string; id: string }>;
          causedBy: string;
        }
      ),
      {
        sources: [
          { kind: "message", id: firstUser.id },
          { kind: "message", id: survivingUser.id },
        ],
        causedBy: firstUser.id,
      },
    );
    assert.equal(
      (
        sharedMind.payload?.lifecycle_v1 as { salience: number }
      ).salience,
      0.66,
    );
    assert.deepEqual(
      (
        sharedMind.payload?.recall_reinforcement_v1 as {
          contributions: unknown[];
        }
      ).contributions,
      [
        {
          sourceMessageId: firstUser.id,
          recalledAt: "2026-09-27T06:30:00.000Z",
          currentValue: 0.08,
        },
        {
          sourceMessageId: survivingUser.id,
          recalledAt: "2026-09-27T07:00:00.000Z",
          currentValue: 0.08,
        },
      ],
    );

    const survivingDrive = preservedById.get(survivingDriveStateId);
    assert.ok(survivingDrive);
    assert.deepEqual(survivingDrive.payload, {
      drive_v1: {
        reinforcementSources: [
          survivingUser.id,
          secondAssistant.message.id,
        ],
      },
    });
    assert.equal(
      preservedById.get(scopedMindStateId)?.scopeConversationId,
      deletedConversation.id,
      "Mind keeps historical source/scope ids even after the source window is deleted",
    );

    const postDeleteWakeId = crypto.randomUUID();
    await assert.rejects(
      proactivity.createOrGet({
        gate: {
          wakeId: postDeleteWakeId,
          userId,
          subjectId: "G",
          offeredAt: "2026-09-27T08:00:00.000Z",
          mode: "live",
          enabled: true,
          foregroundActive: false,
          outstandingEffectStatus: null,
          quietUntil: null,
          nextEligibleAt: null,
        },
        contactTarget: null,
        context: {
          version: 1,
          contextManifestId: null,
          capsule: "must not recreate deleted conversation work",
          sourceConversationId: deletedConversation.id,
          sourceHeadMessageId: secondAssistant.message.id,
          sourceActivityAt: "2026-09-27T07:00:00.000Z",
        },
      }),
      /SourceConversationInactive/,
    );

    assert.equal(
      (await service.deleteConversation({
        userId,
        conversationId: deletedConversation.id,
      })).outcome,
      "not_found",
    );
  },
);


test(
  "true Delete removes the source conversation while opaque Mind payload and provenance survive unchanged",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, {
      ssl: false,
      createClient: (url, maxConnections, ssl) =>
        postgres(url, {
          max: maxConnections,
          prepare: false,
          ssl,
          connect_timeout: 15,
          idle_timeout: 60,
        }),
    });
    let userId: string | null = null;
    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-delete-mind-survives-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Delete Mind Survives",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const service = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await service.createConversation({
      userId,
      title: "Mind source can disappear",
    });
    const userMessage = await service.appendUserMessage({
      userId,
      conversationId: conversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "causal source" }],
    });

    const stateId = crypto.randomUUID();
    const payload = {
      future_unknown_projection_v1: {
        sourceId: userMessage.id,
      },
    };
    const envelope = {
      authority: "derived",
      scope: {
        userId,
        subjectId: "G",
        applicability: "global",
      },
      provenance: {
        sources: [{ kind: "message", id: userMessage.id }],
        causedBy: userMessage.id,
      },
    };
    await database.db.insert(runtimeSubjectStates).values({
      id: stateId,
      userId,
      subjectId: "G",
      kind: "memory",
      text: "Mind state outlives its source conversation",
      payload,
      scopeApplicability: "global",
      scopeConversationId: null,
      scopePathHeadMessageId: null,
      settlementStatus: "settled",
      pathStatus: "current",
      validityStatus: "valid",
      envelope,
    });

    assert.equal(
      (await service.deleteConversation({
        userId,
        conversationId: conversation.id,
      })).outcome,
      "deleted",
    );
    assert.equal(
      await service.getConversation({
        userId,
        conversationId: conversation.id,
      }),
      null,
    );
    const deletedMessages = await database.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, conversation.id));
    assert.deepEqual(deletedMessages, []);

    const [survivingState] = await database.db
      .select({
        id: runtimeSubjectStates.id,
        payload: runtimeSubjectStates.payload,
        envelope: runtimeSubjectStates.envelope,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.id, stateId));
    assert.deepEqual(survivingState, {
      id: stateId,
      payload,
      envelope,
    });
  },
);

test(
  "Delete ignores terminal delivery-unknown turns but still blocks executing turns",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, {
      ssl: false,
      createClient: (url, maxConnections, ssl) =>
        postgres(url, {
          max: maxConnections,
          prepare: false,
          ssl,
          connect_timeout: 15,
          idle_timeout: 60,
        }),
    });
    let userId: string | null = null;
    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db.delete(users).where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-delete-delivery-unknown-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Delete Delivery Unknown",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const service = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );

    const deliveryUnknownConversation = await service.createConversation({
      userId,
      title: "Delivery unknown may be deleted",
    });
    const deliveryUnknownUser = await service.appendUserMessage({
      userId,
      conversationId: deliveryUnknownConversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "terminal delivery unknown" }],
    });
    const listenerId = crypto.randomUUID();
    const now = new Date();
    await database.db.insert(nativeLiveTurnPreparations).values({
      id: crypto.randomUUID(),
      userId,
      requestId: crypto.randomUUID(),
      conversationId: deliveryUnknownConversation.id,
      operation: "send",
      requestHash: "a".repeat(64),
      canonicalUserMessageId: deliveryUnknownUser.id,
      runtimeMode: "new",
      parentProviderSessionId: null,
      prompt: "terminal delivery unknown",
      status: "prepared",
      dispatchStatus: "delivery_unknown",
      reservedBy: listenerId,
      reservedAt: new Date(now.getTime() - 120_000),
      reservationExpiresAt: new Date(now.getTime() - 60_000),
      executionStartedAt: new Date(now.getTime() - 110_000),
      deliveryUnknownAt: new Date(now.getTime() - 50_000),
      dispatchErrorCode: "RESULT_DELIVERY_UNKNOWN",
    });

    assert.equal(
      (await service.deleteConversation({
        userId,
        conversationId: deliveryUnknownConversation.id,
      })).outcome,
      "deleted",
    );

    const executingConversation = await service.createConversation({
      userId,
      title: "Executing stays protected",
    });
    const executingUser = await service.appendUserMessage({
      userId,
      conversationId: executingConversation.id,
      parentMessageId: null,
      blocks: [{ kind: "text", text: "still executing" }],
    });
    await database.db.insert(nativeLiveTurnPreparations).values({
      id: crypto.randomUUID(),
      userId,
      requestId: crypto.randomUUID(),
      conversationId: executingConversation.id,
      operation: "send",
      requestHash: "b".repeat(64),
      canonicalUserMessageId: executingUser.id,
      runtimeMode: "new",
      parentProviderSessionId: null,
      prompt: "still executing",
      status: "prepared",
      dispatchStatus: "executing",
      reservedBy: crypto.randomUUID(),
      reservedAt: now,
      reservationExpiresAt: new Date(now.getTime() + 60_000),
      executionStartedAt: now,
    });

    assert.equal(
      (await service.deleteConversation({
        userId,
        conversationId: executingConversation.id,
      })).outcome,
      "busy",
    );
  },
);
