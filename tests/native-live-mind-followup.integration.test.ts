import assert from "node:assert/strict";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveMindFollowUps,
  nativeLiveRuntimeListenerLeases,
  runtimeContextManifests,
  runtimeContextLineageStates,
  runtimeSubjectStates,
  users,
} from "../src/database/schema.js";
import {
  NativeLiveBackendTurnCoordinator,
} from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import {
  DrizzleNativeLiveBackendTurnPort,
} from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import {
  DrizzleNativeLiveContextLineageReader,
} from "../src/domains/bridge/turn/native-live-context-lineage-repository.js";
import {
  NativeLiveManualCompactService,
} from "../src/domains/bridge/turn/native-live-manual-compact.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
} from "../src/domains/bridge/relay/native-live-backend-relay.js";
import {
  DrizzleNativeLiveMindFollowUpRepository,
  NativeLiveMindFollowUpService,
} from "../src/domains/bridge/mind/native-live-mind-followup.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  createDefaultBackendMindRuntime,
} from "../src/domains/runtime/mind/default-backend-mind-runtime.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_MIND_FOLLOWUP_DATABASE_TEST === "1";

test(
  "Hook-only follow-up survives a canonical crash window and drains legacy intents without implicit Memory writes",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await database.db
            .delete(runtimeContextManifests)
            .where(eq(runtimeContextManifests.userId, userId));
          await database.db
            .delete(nativeLiveRuntimeListenerLeases)
            .where(eq(nativeLiveRuntimeListenerLeases.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db
            .delete(users)
            .where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const suffix = crypto.randomUUID();
    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-followup-${suffix}@example.com`,
        displayName: "Native Live Follow-up",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId,
      title: "Durable Mind follow-up",
    });

    const turnPort = new DrizzleNativeLiveBackendTurnPort(database.db);
    const backendMind = createDefaultBackendMindRuntime(database.db);
    const crashAfterCanonical = {
      async processPreparation() {
        throw new Error("simulated process death after canonical commit");
      },
    };
    const coordinator = new NativeLiveBackendTurnCoordinator(
      turnPort,
      undefined,
      backendMind,
      crashAfterCanonical,
    );

    const requestId = crypto.randomUUID();
    const prepared = await coordinator.prepare(userId, {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "remember the durable outbox",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw new Error("expected prepare success");

    const relay =
      new DrizzleNativeLiveBackendRelayRepository(database.db);
    const listenerInstanceId = crypto.randomUUID();
    assert.equal(
      await relay.enqueuePreparation({
        userId,
        prepareId: prepared.command.prepare_id,
      }),
      "applied",
    );
    assert.equal(
      await relay.renewLease({
        userId,
        listenerInstanceId,
      }),
      "acquired",
    );
    const reservation = await relay.reserveNext({
      userId,
      listenerInstanceId,
    });
    assert.equal(
      reservation?.prepareId,
      prepared.command.prepare_id,
    );
    assert.equal(
      await relay.markExecutionStarted({
        userId,
        listenerInstanceId,
        reservationId: prepared.command.prepare_id,
      }),
      "applied",
    );

    const finalized = await coordinator.finalize(userId, {
      protocol_version: 4,
      provider_checkpoint_id: crypto.randomUUID(),
      prepare_id: prepared.command.prepare_id,
      request_id: requestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "followup-provider-1",
      normalized_events: [
        {
          type: "text",
          payload: {
            text: "VISIBLE <memory>durable outbox memory</memory>",
          },
        },
        {
          type: "result",
          payload: {
            status: "success",
            final_text:
              "VISIBLE <memory>durable outbox memory</memory>",
          },
        },
      ],
    });
    assert.equal(finalized.ok, true);
    if (!finalized.ok) throw new Error("expected canonical success");

    const canonical = await conversationService.getConversation({ userId, conversationId: conversation.id });
    const answer = canonical?.messages.find(message => message.id === finalized.assistantMessageId);
    assert.ok(answer);
    assert.equal(answer.blocks.filter(block => block.kind === "text").map(block => block.text).join(""),
      "VISIBLE <memory>durable outbox memory</memory>", "tags remain visible prose, not a successful Memory write");
    const [lineageAfterCanonical] = await database.db
      .select({
        seenStateIds: runtimeContextLineageStates.seenStateIds,
      })
      .from(runtimeContextLineageStates)
      .where(
        and(
          eq(runtimeContextLineageStates.userId, userId),
          eq(
            runtimeContextLineageStates.canonicalMessageId,
            finalized.assistantMessageId,
          ),
        ),
      )
      .limit(1);
    assert.equal(lineageAfterCanonical, undefined,
      "Hook-only completion has no backend manifest or tag-write lineage");

    const lineageReader =
      new DrizzleNativeLiveContextLineageReader(database.db);
    assert.deepEqual(
      await lineageReader.readForMessage({
        userId,
        conversationId: conversation.id,
        canonicalMessageId: finalized.assistantMessageId,
      }),
      {
        epoch: 0,
        seenStateIds: [],
      },
    );

    assert.equal(
      await relay.markCompleted({
        userId,
        listenerInstanceId,
        reservationId: prepared.command.prepare_id,
      }),
      "applied",
    );

    const [pending] = await database.db
      .select({
        status: nativeLiveMindFollowUps.status,
        retryCount: nativeLiveMindFollowUps.retryCount,
        assistantMessageId: nativeLiveMindFollowUps.assistantMessageId,
        intents: nativeLiveMindFollowUps.intents,
        actions: nativeLiveMindFollowUps.actions,
      })
      .from(nativeLiveMindFollowUps)
      .where(
        and(
          eq(nativeLiveMindFollowUps.userId, userId),
          eq(nativeLiveMindFollowUps.prepareId, prepared.command.prepare_id),
        ),
      )
      .limit(1);
    assert.deepEqual(pending, {
      status: "pending",
      retryCount: 0,
      assistantMessageId: finalized.assistantMessageId,
      intents: [],
      actions: [],
    });

    // Represent a pre-deployment queued tag intent. Recovery must drain it,
    // never recreate the retired implicit Memory persistence channel.
    await database.db.update(nativeLiveMindFollowUps).set({ intents: [{
      kind: "memory", text: "durable outbox memory", sourceStart: 8, sourceEnd: 45,
      raw: "<memory>durable outbox memory</memory>",
    }] }).where(eq(nativeLiveMindFollowUps.prepareId, prepared.command.prepare_id));

    const beforeRecovery = await database.db
      .select({ id: runtimeSubjectStates.id })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, userId));
    assert.equal(beforeRecovery.length, 0);

    const service = new NativeLiveMindFollowUpService(
      new DrizzleNativeLiveMindFollowUpRepository(database.db),
      turnPort,
      backendMind,
      crypto.randomUUID(),
    );

    assert.equal(
      (await conversationService.archiveConversation({
        userId,
        conversationId: conversation.id,
      })).outcome,
      "archived",
    );
    assert.equal(
      await service.processPreparation({
        userId,
        prepareId: prepared.command.prepare_id,
      }),
      "idle",
      "archived conversation must fence delayed Mind follow-up",
    );

    const stillBeforeRestore = await database.db
      .select({ id: runtimeSubjectStates.id })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, userId));
    assert.equal(stillBeforeRestore.length, 0);

    assert.equal(
      (await conversationService.restoreConversation({
        userId,
        conversationId: conversation.id,
      })).outcome,
      "restored",
    );
    assert.equal(
      await service.processPreparation({
        userId,
        prepareId: prepared.command.prepare_id,
      }),
      "processed",
    );

    const afterRecovery = await database.db
      .select({
        id: runtimeSubjectStates.id,
        text: runtimeSubjectStates.text,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, userId));
    assert.deepEqual(afterRecovery, [], "legacy outbox recovery must not create Memory from prose");

    const [completed] = await database.db
      .select({
        status: nativeLiveMindFollowUps.status,
        completedAt: nativeLiveMindFollowUps.completedAt,
      })
      .from(nativeLiveMindFollowUps)
      .where(eq(nativeLiveMindFollowUps.prepareId, prepared.command.prepare_id))
      .limit(1);
    assert.equal(completed?.status, "completed");
    assert.ok(completed?.completedAt);

    await database.db
      .update(nativeLiveMindFollowUps)
      .set({
        status: "pending",
        availableAt: new Date(0),
        lockedBy: null,
        lockedUntil: null,
        completedAt: null,
      })
      .where(eq(nativeLiveMindFollowUps.prepareId, prepared.command.prepare_id));

    assert.equal(
      await service.processPreparation({
        userId,
        prepareId: prepared.command.prepare_id,
      }),
      "processed",
    );

    const afterReplay = await database.db
      .select({
        id: runtimeSubjectStates.id,
        text: runtimeSubjectStates.text,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, userId));
    assert.deepEqual(afterReplay, [], "replaying a legacy job still has no implicit write");
    assert.equal(await service.processPreparation({ userId, prepareId: prepared.command.prepare_id }), "idle",
      "completed follow-ups cannot execute again");

    const scheduleRequestId = crypto.randomUUID();
    const schedulePrepared = await coordinator.prepare(userId, {
      dispatch_target: "claude_code",
      request_id: scheduleRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: finalized.assistantMessageId,
      text: "/schedule daily at 9am remember this",
    });
    assert.equal(schedulePrepared.ok, true);
    if (!schedulePrepared.ok) {
      throw new Error("expected schedule prepare success");
    }
    assert.equal(
      schedulePrepared.command.prompt,
      "/schedule daily at 9am remember this",
      "native schedule commands bypass Mind Context Assembly",
    );

    assert.equal(schedulePrepared.command.runtime_mode, "resume");
    assert.equal(schedulePrepared.command.parent_provider_session_id, "followup-provider-1");
    assert.ok(schedulePrepared.command.parent_provider_checkpoint_id);
    const scheduleFinalized = await coordinator.finalize(userId, {
      protocol_version: 4,
      provider_checkpoint_id: crypto.randomUUID(),
      prepare_id: schedulePrepared.command.prepare_id,
      request_id: scheduleRequestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "followup-provider-1",
      normalized_events: [
        {
          type: "text",
          payload: {
            text: "scheduled <memory>schedule-side memory</memory>",
          },
        },
        {
          type: "result",
          payload: {
            status: "success",
            final_text:
              "scheduled <memory>schedule-side memory</memory>",
          },
        },
      ],
    });
    assert.equal(scheduleFinalized.ok, true);
    if (!scheduleFinalized.ok) {
      throw new Error("expected schedule canonical success");
    }

    assert.deepEqual(
      await lineageReader.readForMessage({
        userId,
        conversationId: conversation.id,
        canonicalMessageId: scheduleFinalized.assistantMessageId,
      }),
      {
        epoch: 0,
        seenStateIds: [],
      },
      "a schedule turn does not invent written IDs from assistant prose",
    );

    const preCompactProbeRequestId = crypto.randomUUID();
    const preCompactProbe = await coordinator.prepare(userId, {
      dispatch_target: "claude_code",
      request_id: preCompactProbeRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: scheduleFinalized.assistantMessageId,
      text: "durable outbox memory",
    });
    assert.equal(preCompactProbe.ok, true);
    if (!preCompactProbe.ok) {
      throw new Error("expected pre-compact probe prepare success");
    }
    assert.equal(
      preCompactProbe.command.prompt.includes("Relevant memories:"),
      false,
      "backend preparation must not add a second context before compact",
    );
    const preCompactProbeFailure = await coordinator.finalize(userId, {
      protocol_version: 4,
      prepare_id: preCompactProbe.command.prepare_id,
      request_id: preCompactProbeRequestId,
      conversation_id: conversation.id,
      status: "failure",
      error_code: "ABORTED",
    });
    assert.equal(preCompactProbeFailure.ok, false);

    await relay.renewLease({
      userId,
      listenerInstanceId,
    });
    const manualCompact =
      new NativeLiveManualCompactService(database.db);
    const compactRequest = await manualCompact.create({
      userId,
      conversationId: conversation.id,
    });
    assert.equal(compactRequest.status, "pending");

    const compactReservation = await manualCompact.reserveNext({
      userId,
      listenerInstanceId,
    });
    assert.ok(compactReservation);
    assert.equal(
      compactReservation.providerSessionId,
      "followup-provider-1",
    );

    assert.equal(
      await manualCompact.complete({
        userId,
        listenerInstanceId,
        reservationId: compactReservation.reservationId,
        outcome: {
          status: "success",
          result: {
            providerSessionId: "followup-provider-1",
            providerCheckpointId: crypto.randomUUID(),
            contextUsage: null,
            boundary: { source: "test" },
            summary: "test compact",
          },
        },
      }),
      "completed",
    );

    assert.deepEqual(
      await lineageReader.readForMessage({
        userId,
        conversationId: conversation.id,
        canonicalMessageId: scheduleFinalized.assistantMessageId,
      }),
      {
        epoch: 1,
        seenStateIds: [],
      },
      "successful compact starts a fresh memory context epoch",
    );

    const nextRequestId = crypto.randomUUID();
    const nextPrepared = await coordinator.prepare(userId, {
      dispatch_target: "claude_code",
      request_id: nextRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: scheduleFinalized.assistantMessageId,
      text: "durable outbox memory",
    });
    assert.equal(nextPrepared.ok, true);
    if (!nextPrepared.ok) throw new Error("expected next prepare success");
    assert.equal(nextPrepared.command.prompt, "durable outbox memory",
      "compact keeps raw prompt delivery; automatic recall remains Hook-owned");
    assert.deepEqual(await database.db.select({ id: runtimeSubjectStates.id }).from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, userId)), []);
    assert.deepEqual(await database.db.select({ id: runtimeContextManifests.id }).from(runtimeContextManifests)
      .where(eq(runtimeContextManifests.userId, userId)), [], "backend creates no automatic recall receipt");

    assert.equal(nextPrepared.command.runtime_mode, "resume");
    assert.equal(nextPrepared.command.parent_provider_session_id, "followup-provider-1");
    assert.ok(nextPrepared.command.parent_provider_checkpoint_id);
    const nextFailure = await coordinator.finalize(userId, {
      protocol_version: 4,
      prepare_id: nextPrepared.command.prepare_id,
      request_id: nextRequestId,
      conversation_id: conversation.id,
      status: "failure",
      error_code: "ABORTED",
    });
    assert.equal(nextFailure.ok, false);
  },
);

test(
  "malformed durable Mind follow-up is quarantined without starving the next valid job",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await database.db
            .delete(runtimeContextManifests)
            .where(eq(runtimeContextManifests.userId, userId));
          await database.db
            .delete(conversations)
            .where(eq(conversations.userId, userId));
          await database.db
            .delete(users)
            .where(eq(users.id, userId));
        }
      } finally {
        await database.close();
      }
    });

    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-followup-quarantine-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Follow-up Quarantine",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId,
      title: "Mind follow-up quarantine",
    });
    const turnPort = new DrizzleNativeLiveBackendTurnPort(database.db);
    const backendMind = createDefaultBackendMindRuntime(database.db);
    const leavePending = {
      async processPreparation() {
        throw new Error("leave durable follow-up pending");
      },
    };
    const coordinator = new NativeLiveBackendTurnCoordinator(
      turnPort,
      undefined,
      backendMind,
      leavePending,
    );

    async function finalizeTurn(
      requestId: string,
      expectedHeadMessageId: string | null,
      userText: string,
      memoryText: string,
      providerSessionId: string,
    ) {
      const prepared = await coordinator.prepare(userId!, {
        dispatch_target: "claude_code",
        request_id: requestId,
        operation: "send",
        conversation_id: conversation.id,
        expected_head_message_id: expectedHeadMessageId,
        text: userText,
      });
      assert.equal(prepared.ok, true);
      if (!prepared.ok) throw new Error("expected prepare success");

      const finalized = await coordinator.finalize(userId!, {
        protocol_version: 4,
        prepare_id: prepared.command.prepare_id,
        request_id: requestId,
        conversation_id: conversation.id,
        status: "success",
        provider_session_id: prepared.command.runtime_mode === "resume" ? prepared.command.parent_provider_session_id! : providerSessionId,
        provider_checkpoint_id: prepared.command.prepare_id,
        normalized_events: [
          {
            type: "text",
            payload: {
              text: `VISIBLE <memory>${memoryText}</memory>`,
            },
          },
          {
            type: "result",
            payload: {
              status: "success",
              final_text: `VISIBLE <memory>${memoryText}</memory>`,
            },
          },
        ],
      });
      assert.equal(finalized.ok, true);
      if (!finalized.ok) throw new Error("expected finalize success");
      return {
        prepareId: prepared.command.prepare_id,
        assistantMessageId: finalized.assistantMessageId,
      };
    }

    const first = await finalizeTurn(
      crypto.randomUUID(),
      null,
      "first",
      "first memory",
      "quarantine-provider-1",
    );
    const second = await finalizeTurn(
      crypto.randomUUID(),
      first.assistantMessageId,
      "second",
      "second memory",
      "quarantine-provider-2",
    );

    await database.db
      .update(nativeLiveMindFollowUps)
      .set({
        intents: [{ kind: "dream" }],
        availableAt: new Date(0),
      })
      .where(eq(nativeLiveMindFollowUps.prepareId, first.prepareId));
    await database.db
      .update(nativeLiveMindFollowUps)
      .set({ availableAt: new Date(1) })
      .where(eq(nativeLiveMindFollowUps.prepareId, second.prepareId));

    const repository =
      new DrizzleNativeLiveMindFollowUpRepository(database.db);
    const workerId = crypto.randomUUID();
    const claimed = await repository.claimNext({ workerId });
    assert.ok(claimed);
    assert.equal(claimed.prepareId, second.prepareId);

    const [malformed] = await database.db
      .select({
        status: nativeLiveMindFollowUps.status,
        lockedBy: nativeLiveMindFollowUps.lockedBy,
        lockedUntil: nativeLiveMindFollowUps.lockedUntil,
        lastErrorName: nativeLiveMindFollowUps.lastErrorName,
      })
      .from(nativeLiveMindFollowUps)
      .where(eq(nativeLiveMindFollowUps.prepareId, first.prepareId))
      .limit(1);
    assert.equal(malformed?.status, "quarantined");
    assert.equal(malformed?.lockedBy, null);
    assert.equal(malformed?.lockedUntil, null);
    assert.equal(
      malformed?.lastErrorName,
      "NativeLiveMindFollowUpPayloadInvalid",
    );

    const [valid] = await database.db
      .select({
        status: nativeLiveMindFollowUps.status,
        lockedBy: nativeLiveMindFollowUps.lockedBy,
      })
      .from(nativeLiveMindFollowUps)
      .where(eq(nativeLiveMindFollowUps.prepareId, second.prepareId))
      .limit(1);
    assert.equal(valid?.status, "processing");
    assert.equal(valid?.lockedBy, workerId);
  },
);

test(
  "open follow-ups from before the Mind rework are read forgivingly: retired intents and actions are skipped, never reinterpreted",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    let userId: string | null = null;

    t.after(async () => {
      try {
        if (userId) {
          await database.db
            .delete(runtimeSubjectStates)
            .where(eq(runtimeSubjectStates.userId, userId));
          await database.db
            .delete(runtimeContextManifests)
            .where(eq(runtimeContextManifests.userId, userId));
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
        email: `native-live-followup-legacy-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Follow-up Legacy",
      })
      .returning({ id: users.id });
    assert.ok(user);
    userId = user.id;

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId,
      title: "Mind follow-up legacy",
    });
    const coordinator = new NativeLiveBackendTurnCoordinator(
      new DrizzleNativeLiveBackendTurnPort(database.db),
      undefined,
      createDefaultBackendMindRuntime(database.db),
      {
        async processPreparation() {
          throw new Error("leave durable follow-up pending");
        },
      },
    );

    async function finalizeTurn(
      expectedHeadMessageId: string | null,
      text: string,
    ) {
      const requestId = crypto.randomUUID();
      const prepared = await coordinator.prepare(userId!, {
        dispatch_target: "claude_code",
        request_id: requestId,
        operation: "send",
        conversation_id: conversation.id,
        expected_head_message_id: expectedHeadMessageId,
        text,
      });
      assert.equal(prepared.ok, true);
      if (!prepared.ok) throw new Error("expected prepare success");
      const finalized = await coordinator.finalize(userId!, {
        protocol_version: 4,
        prepare_id: prepared.command.prepare_id,
        request_id: requestId,
        conversation_id: conversation.id,
        status: "success",
        provider_session_id: prepared.command.runtime_mode === "resume" ? prepared.command.parent_provider_session_id! : `legacy-provider-${crypto.randomUUID()}`,
        provider_checkpoint_id: prepared.command.prepare_id,
        normalized_events: [
          { type: "text", payload: { text: "VISIBLE" } },
          {
            type: "result",
            payload: { status: "success", final_text: "VISIBLE" },
          },
        ],
      });
      assert.equal(finalized.ok, true);
      if (!finalized.ok) throw new Error("expected finalize success");
      return {
        prepareId: prepared.command.prepare_id,
        assistantMessageId: finalized.assistantMessageId,
      };
    }

    const legacy = await finalizeTurn(null, "legacy turn");
    const strict = await finalizeTurn(
      legacy.assistantMessageId,
      "strict turn",
    );

    await database.db
      .update(nativeLiveMindFollowUps)
      .set({
        availableAt: new Date(0),
        intents: [
          {
            kind: "drive",
            text: "still want this",
            sourceStart: 0,
            sourceEnd: 30,
            raw: "<drive>still want this</drive>",
          },
          {
            kind: "thought",
            text: "still wondering",
            sourceStart: 31,
            sourceEnd: 70,
            raw: "<curiosity>still wondering</curiosity>",
          },
          {
            kind: "feel",
            text: "kept as is",
            sourceStart: 71,
            sourceEnd: 100,
            raw: "<feel>kept as is</feel>",
          },
        ],
        actions: [
          {
            kind: "mind_satisfy",
            stateId: crypto.randomUUID(),
            level: "full",
            sourceStart: 0,
            sourceEnd: 1,
            raw: "x",
          },
          {
            kind: "mind_resolve",
            stateId: crypto.randomUUID(),
            sourceStart: 2,
            sourceEnd: 3,
            raw: "y",
          },
          {
            kind: "thought_drop",
            ref: "T2",
            sourceStart: 4,
            sourceEnd: 5,
            raw: "z",
          },
        ],
      })
      .where(eq(nativeLiveMindFollowUps.prepareId, legacy.prepareId));
    // The second job is genuinely malformed: an unknown action kind.
    await database.db
      .update(nativeLiveMindFollowUps)
      .set({
        availableAt: new Date(1),
        intents: [{kind:"unknown", text:"malformed"}],
      })
      .where(eq(nativeLiveMindFollowUps.prepareId, strict.prepareId));

    const repository =
      new DrizzleNativeLiveMindFollowUpRepository(database.db);
    const claimed = await repository.claimNext({
      workerId: crypto.randomUUID(),
    });
    assert.ok(claimed);
    assert.equal(claimed.prepareId, legacy.prepareId);
    // Retired kinds are skipped, not reinterpreted; the rest of the job runs.
    assert.deepEqual(
      claimed.intents.map((intent) => [intent.kind, intent.text]),
      [["memory", "kept as is"]],
    );
    assert.deepEqual(claimed.actions, []);
    assert.equal(claimed.intents[0]?.writeOrdinal, 2);

    // Unknown current intent kinds are still quarantined.
    assert.equal(
      await repository.claimNext({ workerId: crypto.randomUUID() }),
      null,
    );
    const [quarantined] = await database.db
      .select({ lastErrorName: nativeLiveMindFollowUps.lastErrorName })
      .from(nativeLiveMindFollowUps)
      .where(eq(nativeLiveMindFollowUps.prepareId, strict.prepareId));
    assert.equal(
      quarantined?.lastErrorName,
      "NativeLiveMindFollowUpPayloadInvalid",
    );
  },
);
