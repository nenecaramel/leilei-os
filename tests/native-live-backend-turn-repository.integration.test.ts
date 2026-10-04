import assert from "node:assert/strict";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  readThoughtLifecycle,
  writeThoughtActive,
  writeThoughtDropped,
} from "../src/domains/runtime/thought/thought.js";
import {
  nativeLiveBackgroundModelJobs,
  nativeLiveChatAttachments,
  nativeLiveProviderSessionCleanups,
  nativeLiveTurnPreparations,
  conversations,
  workspaceConversations,
  workspaces,
  runtimeDistillationWatermarks,
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
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";
import {
  DrizzleNativeLiveConversationRuntimeMetadataReader,
} from "../src/domains/conversation/native-live-conversation-runtime-metadata.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST === "1";

test(
  "persisted backend turn port is idempotent across prepare/finalize and preserves exact branch checkpoints",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });

    const suffix = crypto.randomUUID();
    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-turn-${suffix}@example.com`,
        displayName: "Native Live Turn",
      })
      .returning({ id: users.id });
    assert.ok(user);

    t.after(async () => {
      try {
        await database.db
          .delete(nativeLiveBackgroundModelJobs)
          .where(eq(nativeLiveBackgroundModelJobs.userId, user.id));
        await database.db
          .delete(nativeLiveProviderSessionCleanups)
          .where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
        await database.db
          .delete(nativeLiveChatAttachments)
          .where(eq(nativeLiveChatAttachments.userId, user.id));
        await database.db
          .delete(runtimeSubjectStates)
          .where(eq(runtimeSubjectStates.userId, user.id));
        await database.db
          .delete(conversations)
          .where(eq(conversations.userId, user.id));
        await database.db.delete(users).where(eq(users.id, user.id));
      } finally {
        await database.close();
      }
    });

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const runtimeMetadataReader =
      new DrizzleNativeLiveConversationRuntimeMetadataReader(database.db);
    const conversation = await conversationService.createConversation({
      userId: user.id,
      title: "Backend turn persistence",
    });

    const port = new DrizzleNativeLiveBackendTurnPort(database.db);
    const coordinator = new NativeLiveBackendTurnCoordinator(
      port,
      () => crypto.randomUUID(),
    );

    const firstRequestId =
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const firstPrepare = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: firstRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "hello",
    });
    assert.equal(firstPrepare.ok, true);
    if (!firstPrepare.ok) throw new Error("expected first prepare success");
    assert.equal(firstPrepare.outcome, "created");
    assert.equal(firstPrepare.command.runtime_mode, "new");
    assert.equal(firstPrepare.command.parent_provider_session_id, null);
    const firstUserId = firstPrepare.command.canonical_user_message_id;

    const pendingRead = await port.readTurn({
      userId: user.id,
      prepareId: firstPrepare.command.prepare_id,
    });
    assert.ok(pendingRead);
    assert.equal(pendingRead.canonicalStatus, "prepared");
    assert.equal(pendingRead.dispatchStatus, "staged");
    assert.equal(pendingRead.assistantMessage, null);

    const replay = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: firstRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "hello",
    });
    assert.equal(replay.ok, true);
    if (!replay.ok) throw new Error("expected replay success");
    assert.equal(replay.outcome, "replayed");
    assert.equal(
      replay.command.canonical_user_message_id,
      firstUserId,
    );
    assert.equal(replay.command.prepare_id, firstPrepare.command.prepare_id);

    const conflictingReplay = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: firstRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "different",
    });
    assert.deepEqual(conflictingReplay, {
      ok: false,
      requestId: firstRequestId,
      operation: "send",
      conversationId: conversation.id,
      code: "REQUEST_CONFLICT",
    });

    const persistedMind = await port.persistMindPreparedPrompt({
      userId: user.id,
      prepareId: firstPrepare.command.prepare_id,
      prompt: "ASSEMBLED hello",
    });
    assert.equal(persistedMind.mindPrepared, true);
    assert.equal(persistedMind.prompt, "ASSEMBLED hello");

    const replayAfterMind = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: firstRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "hello",
    });
    assert.equal(replayAfterMind.ok, true);
    if (!replayAfterMind.ok) throw new Error("expected replay after Mind");
    assert.equal(replayAfterMind.command.prompt, "ASSEMBLED hello");

    const runtimeMetadata = {
      context_usage: null,
      execution: {
        readback: {
          requested: {
            model: "claude-sonnet-5",
            thinking: "adaptive",
            effort: "low",
          },
          applied: {
            model: "claude-sonnet-5",
            effort: "low",
          },
          capability: null,
        },
        readback_error: null,
      },
    };

    const outputAttachmentId = crypto.randomUUID();
    await database.db
      .insert(nativeLiveChatAttachments)
      .values({
        id: outputAttachmentId,
        userId: user.id,
        objectKey:
          "native-live/"
          + user.id
          + "/"
          + outputAttachmentId,
        filename: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 321,
        sha256: "a".repeat(64),
        kind: "file",
        status: "ready",
        readyAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

    const firstFinalize = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: firstPrepare.command.prepare_id,
      request_id: firstRequestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-first",
      normalized_events: [
        { type: "text", payload: { text: "first answer" } },
        {
          type: "result",
          payload: { status: "success", final_text: "first answer" },
        },
      ],
      output_attachment_ids: [outputAttachmentId],
      runtime_metadata: runtimeMetadata,
    });
    assert.equal(firstFinalize.ok, true);
    if (!firstFinalize.ok) throw new Error("expected first finalize success");
    assert.equal(firstFinalize.outcome, "completed");

    const finalizedRead = await port.readTurn({
      userId: user.id,
      prepareId: firstPrepare.command.prepare_id,
    });
    assert.ok(finalizedRead);
    assert.equal(finalizedRead.canonicalStatus, "finalized_success");
    assert.equal(
      finalizedRead.assistantMessage?.id,
      firstFinalize.assistantMessageId,
    );
    assert.equal(
      finalizedRead.assistantMessage?.blocks[0]?.text,
      "first answer",
    );
    assert.equal(
      finalizedRead.assistantMessage?.blocks[1]?.kind,
      "attachment",
    );
    assert.equal(
      finalizedRead.assistantMessage?.blocks[1]?.payload
        ?.attachment_id,
      outputAttachmentId,
    );
    assert.deepEqual(finalizedRead.assistantMessage?.blocks[1]?.payload?.refs, [{type:"attachment_ref",entity_id:outputAttachmentId}]);
    assert.equal((finalizedRead.assistantMessage?.blocks[1]?.payload?.provenance as Record<string, unknown>)?.origin,"provider_send");
    const [boundOutputAttachment] = await database.db
      .select()
      .from(nativeLiveChatAttachments)
      .where(eq(nativeLiveChatAttachments.id, outputAttachmentId))
      .limit(1);
    assert.equal(boundOutputAttachment?.status, "bound");
    assert.equal(
      boundOutputAttachment?.boundMessageId,
      firstFinalize.assistantMessageId,
    );
    assert.deepEqual(finalizedRead.runtimeMetadata, runtimeMetadata);

    const finalizedCheckpoint =
      await conversationService.getProviderCheckpointForHead({
        userId: user.id,
        conversationId: conversation.id,
        canonicalMessageId: firstFinalize.assistantMessageId,
      });
    assert.ok(finalizedCheckpoint);
    assert.equal(
      finalizedCheckpoint.providerSessionId,
      "provider-first",
    );

    const firstDurableMetadata = await runtimeMetadataReader.readLatest({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(firstDurableMetadata);
    assert.equal(
      firstDurableMetadata.currentHeadMessageId,
      firstFinalize.assistantMessageId,
    );
    assert.equal(
      firstDurableMetadata.sourceMessageId,
      firstFinalize.assistantMessageId,
    );
    assert.deepEqual(
      firstDurableMetadata.runtimeMetadata,
      { ...runtimeMetadata, turn_started_at: finalizedRead.startedAt },
    );
    assert.ok(firstDurableMetadata.observedAt);

    const finalizeReplay = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: firstPrepare.command.prepare_id,
      request_id: firstRequestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-first",
      normalized_events: [
        { type: "text", payload: { text: "first answer" } },
        {
          type: "result",
          payload: { status: "success", final_text: "first answer" },
        },
      ],
      output_attachment_ids: [outputAttachmentId],
      runtime_metadata: runtimeMetadata,
    });
    assert.equal(finalizeReplay.ok, true);
    if (!finalizeReplay.ok) throw new Error("expected idempotent finalize");
    assert.equal(finalizeReplay.outcome, "idempotent");
    assert.equal(
      finalizeReplay.assistantMessageId,
      firstFinalize.assistantMessageId,
    );

    const conflictingFinalize = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: firstPrepare.command.prepare_id,
      request_id: firstRequestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-conflict",
      normalized_events: [
        { type: "text", payload: { text: "different answer" } },
      ],
    });
    assert.equal(conflictingFinalize.ok, false);
    if (conflictingFinalize.ok) throw new Error("expected finalize conflict");
    assert.equal(conflictingFinalize.code, "FINALIZE_CONFLICT");

    const afterFirst = await conversationService.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(afterFirst);
    assert.equal(afterFirst.messages.length, 2);
    assert.equal(
      afterFirst.currentHeadMessageId,
      firstFinalize.assistantMessageId,
    );

    const secondRequestId =
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const secondPrepare = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: secondRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: firstFinalize.assistantMessageId,
      text: "second",
    });
    assert.equal(secondPrepare.ok, true);
    if (!secondPrepare.ok) throw new Error("expected second prepare success");
    assert.equal(secondPrepare.command.runtime_mode, "fork");
    assert.equal(
      secondPrepare.command.parent_provider_session_id,
      "provider-first",
    );
    const secondUserId = secondPrepare.command.canonical_user_message_id;

    const secondFinalize = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: secondPrepare.command.prepare_id,
      request_id: secondRequestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-second",
      normalized_events: [
        { type: "text", payload: { text: "second answer" } },
        {
          type: "result",
          payload: { status: "success", final_text: "second answer" },
        },
      ],
    });
    assert.equal(secondFinalize.ok, true);
    if (!secondFinalize.ok) throw new Error("expected second finalize success");
    const oldSecondAssistantId = secondFinalize.assistantMessageId;

    const secondDurableMetadata = await runtimeMetadataReader.readLatest({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(secondDurableMetadata);
    assert.equal(
      secondDurableMetadata.currentHeadMessageId,
      oldSecondAssistantId,
    );
    assert.equal(
      secondDurableMetadata.sourceMessageId,
      oldSecondAssistantId,
    );
    assert.deepEqual(
      secondDurableMetadata.runtimeMetadata,
      { turn_started_at: (await port.readTurn({ userId:user.id, prepareId:secondPrepare.command.prepare_id }))?.startedAt },
      "latest checkpoint carries its own turn start and must not inherit older provider metadata",
    );

    const causalStateId = crypto.randomUUID();
    const safeStateId = crypto.randomUUID();
    const distilledStateId = crypto.randomUUID();

    await database.db.insert(runtimeSubjectStates).values([
      {
        id: causalStateId,
        userId: user.id,
        subjectId: "G",
        kind: "thought",
        text: "old branch thought",
        payload: null,
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          semanticActor: { kind: "subject", id: "G" },
          producer: { kind: "model", id: "test" },
          committer: { kind: "runtime", id: "test" },
          authority: "subject_authorized",
          scope: {
            userId: user.id,
            subjectId: "G",
            applicability: "global",
            conversationId: null,
            pathHeadMessageId: null,
            visibility: "subject_private",
            sensitivity: "normal",
            audience: ["G"],
          },
          status: {
            generationStatus: "committed",
            presentationStatus: "presented",
            pathStatus: "current",
            settlementStatus: "settled",
            validityStatus: "valid",
          },
          provenance: {
            sources: [{ kind: "message", id: oldSecondAssistantId }],
            causedBy: oldSecondAssistantId,
            derivedFrom: [],
          },
          versions: {
            schemaVersion: 1,
            ruleVersion: "test",
            processVersion: "test",
          },
        },
      },
      {
        id: safeStateId,
        userId: user.id,
        subjectId: "G",
        kind: "memory",
        text: "surviving first branch memory",
        payload: null,
        scopeApplicability: "global",
        scopeConversationId: null,
        scopePathHeadMessageId: null,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          semanticActor: { kind: "subject", id: "G" },
          producer: { kind: "model", id: "test" },
          committer: { kind: "runtime", id: "test" },
          authority: "subject_authorized",
          scope: {
            userId: user.id,
            subjectId: "G",
            applicability: "global",
            conversationId: null,
            pathHeadMessageId: null,
            visibility: "subject_private",
            sensitivity: "normal",
            audience: ["G"],
          },
          status: {
            generationStatus: "committed",
            presentationStatus: "presented",
            pathStatus: "current",
            settlementStatus: "settled",
            validityStatus: "valid",
          },
          provenance: {
            sources: [{
              kind: "message",
              id: firstFinalize.assistantMessageId,
            }],
            causedBy: firstFinalize.assistantMessageId,
            derivedFrom: [],
          },
          versions: {
            schemaVersion: 1,
            ruleVersion: "test",
            processVersion: "test",
          },
        },
      },
      {
        id: distilledStateId,
        userId: user.id,
        subjectId: "G",
        kind: "memory",
        text: "distilled before replacement",
        payload: {
          formation: "distillation",
          source_message_count: 2,
        },
        scopeApplicability: "path",
        scopeConversationId: conversation.id,
        scopePathHeadMessageId: firstFinalize.assistantMessageId,
        settlementStatus: "settled",
        pathStatus: "current",
        validityStatus: "valid",
        envelope: {
          semanticActor: { kind: "process", id: "distillation" },
          producer: { kind: "model", id: "test" },
          committer: { kind: "runtime", id: "test" },
          authority: "derived",
          scope: {
            userId: user.id,
            subjectId: "G",
            applicability: "path",
            conversationId: conversation.id,
            pathHeadMessageId: firstFinalize.assistantMessageId,
            visibility: "subject_private",
            sensitivity: "normal",
            audience: ["G"],
          },
          status: {
            generationStatus: "committed",
            presentationStatus: "presented",
            pathStatus: "current",
            settlementStatus: "settled",
            validityStatus: "valid",
          },
          // Historical distilled memories cite every message of their window,
          // so the generic causal purge reaches them without a special case.
          provenance: {
            sources: [
              { kind: "message", id: firstFinalize.assistantMessageId },
              { kind: "message", id: oldSecondAssistantId },
            ],
            causedBy: firstFinalize.assistantMessageId,
            derivedFrom: [
              firstFinalize.assistantMessageId,
              oldSecondAssistantId,
            ],
            processRunId: crypto.randomUUID(),
          },
          versions: {
            schemaVersion: 1,
            ruleVersion: "test",
            processVersion: "test",
          },
        },
      },
    ]);

    // Thoughts: one was dropped by the turn that Retry is about to purge, two
    // others stay active. The dropped one must come back, within the limit.
    const thoughtEnvelope = {
      semanticActor: { kind: "subject", id: "G" },
      producer: { kind: "model", id: "test" },
      committer: { kind: "runtime", id: "test" },
      authority: "subject_authorized",
      scope: {
        userId: user.id,
        subjectId: "G",
        applicability: "global",
        conversationId: null,
        pathHeadMessageId: null,
        visibility: "subject_private",
        sensitivity: "normal",
        audience: ["G"],
      },
      status: {
        generationStatus: "committed",
        presentationStatus: "presented",
        pathStatus: "current",
        settlementStatus: "settled",
        validityStatus: "valid",
      },
      provenance: {
        sources: [{ kind: "manual_entry", id: "manual:thought" }],
        causedBy: "manual:thought",
        derivedFrom: [],
      },
      versions: { schemaVersion: 1, ruleVersion: "test", processVersion: "test" },
    };
    const revivedThoughtId = crypto.randomUUID();
    const keptThoughtIds = [crypto.randomUUID(), crypto.randomUUID()];
    const thoughtRow = (
      id: string,
      text: string,
      createdAt: Date,
      payload: Record<string, unknown>,
    ) => ({
      id,
      userId: user.id,
      subjectId: "G",
      kind: "thought" as const,
      text,
      payload,
      scopeApplicability: "global" as const,
      scopeConversationId: null,
      scopePathHeadMessageId: null,
      settlementStatus: "settled" as const,
      pathStatus: "current" as const,
      validityStatus: "valid" as const,
      envelope: thoughtEnvelope,
      createdAt,
    });
    await database.db.insert(runtimeSubjectStates).values([
      thoughtRow(
        revivedThoughtId,
        "dropped by the turn Retry will purge",
        new Date("2026-09-01T00:00:00.000Z"),
        writeThoughtDropped(null, {
          reason: "subject",
          droppedAt: "2026-09-30T00:00:00.000Z",
          droppedByMessageId: oldSecondAssistantId,
        }),
      ),
      thoughtRow(
        keptThoughtIds[0]!,
        "still active one",
        new Date("2026-09-02T00:00:00.000Z"),
        writeThoughtActive(null),
      ),
      thoughtRow(
        keptThoughtIds[1]!,
        "still active two",
        new Date("2026-09-03T00:00:00.000Z"),
        writeThoughtActive(null),
      ),
    ]);

    await database.db.insert(runtimeDistillationWatermarks).values({
      userId: user.id,
      subjectId: "G",
      conversationId: conversation.id,
      lastSourceMessageId: oldSecondAssistantId,
      processVersion: "test",
    });

    const staleDistillationJobId = crypto.randomUUID();
    await database.db.insert(nativeLiveBackgroundModelJobs).values({
      id: staleDistillationJobId,
      userId: user.id,
      subjectId: "G",
      workflowKind: "distillation",
      workflowRunId: crypto.randomUUID(),
      workflowPayload: {
        conversation_id: conversation.id,
        source_head_message_id: oldSecondAssistantId,
      },
      taskKind: "distillation",
      promptContractVersion: "replacement-purge-test-v1",
      prompt: "stale branch distillation payload",
      status: "pending",
    });

    const retryRequestId =
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const retry = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: retryRequestId,
      operation: "retry",
      conversation_id: conversation.id,
      target_user_message_id: secondUserId,
    });
    assert.equal(retry.ok, true);
    if (!retry.ok) throw new Error("expected retry prepare success");
    assert.equal(retry.command.runtime_mode, "fork");
    assert.equal(
      retry.command.parent_provider_session_id,
      "provider-first",
    );
    assert.equal(retry.command.prompt, "second");

    const retryFinalize = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: retry.command.prepare_id,
      request_id: retryRequestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-retry",
      normalized_events: [
        { type: "text", payload: { text: "retry answer" } },
        {
          type: "result",
          payload: { status: "success", final_text: "retry answer" },
        },
      ],
    });
    assert.equal(retryFinalize.ok, true);
    if (!retryFinalize.ok) throw new Error("expected retry finalize success");

    const afterRetry = await conversationService.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(afterRetry);
    assert.equal(
      afterRetry.messages.some((message) => message.id === oldSecondAssistantId),
      false,
    );
    assert.equal(
      afterRetry.messages.some((message) => message.id === secondUserId),
      true,
    );
    assert.equal(
      afterRetry.currentHeadMessageId,
      retryFinalize.assistantMessageId,
    );

    const statesAfterRetry = await database.db
      .select({ id: runtimeSubjectStates.id })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, user.id));
    const stateIdsAfterRetry = new Set(statesAfterRetry.map((row) => row.id));
    assert.equal(stateIdsAfterRetry.has(causalStateId), false);
    assert.equal(stateIdsAfterRetry.has(distilledStateId), false);
    assert.equal(stateIdsAfterRetry.has(safeStateId), true);

    const thoughtsAfterRetry = await database.db
      .select({
        id: runtimeSubjectStates.id,
        payload: runtimeSubjectStates.payload,
      })
      .from(runtimeSubjectStates)
      .where(and(
        eq(runtimeSubjectStates.userId, user.id),
        eq(runtimeSubjectStates.kind, "thought"),
      ));
    const thoughtStatus = (id: string) =>
      readThoughtLifecycle(
        thoughtsAfterRetry.find((row) => row.id === id)?.payload,
      )?.status;
    assert.equal(
      thoughtStatus(revivedThoughtId),
      "active",
      "a thought dropped by a purged turn is active again after Retry",
    );
    assert.deepEqual(
      keptThoughtIds.map(thoughtStatus),
      ["active", "active"],
    );

    const watermarksAfterRetry = await database.db
      .select({ conversationId: runtimeDistillationWatermarks.conversationId })
      .from(runtimeDistillationWatermarks)
      .where(eq(runtimeDistillationWatermarks.userId, user.id));
    assert.equal(watermarksAfterRetry.length, 0);

    const staleJobsAfterRetry = await database.db
      .select({ id: nativeLiveBackgroundModelJobs.id })
      .from(nativeLiveBackgroundModelJobs)
      .where(eq(
        nativeLiveBackgroundModelJobs.id,
        staleDistillationJobId,
      ));
    assert.equal(
      staleJobsAfterRetry.length,
      0,
      "Retry purge must remove background work derived from the old branch",
    );

    const providerCleanupsAfterRetry = await database.db
      .select({
        providerSessionId:
          nativeLiveProviderSessionCleanups.providerSessionId,
      })
      .from(nativeLiveProviderSessionCleanups)
      .where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
    assert.deepEqual(
      providerCleanupsAfterRetry.map((row) => row.providerSessionId).sort(),
      ["provider-second"],
    );

    const retryCausalStateId = crypto.randomUUID();
    await database.db.insert(runtimeSubjectStates).values({
      id: retryCausalStateId,
      userId: user.id,
      subjectId: "G",
      kind: "thought",
      text: "retry branch thought",
      payload: null,
      scopeApplicability: "global",
      scopeConversationId: null,
      scopePathHeadMessageId: null,
      settlementStatus: "settled",
      pathStatus: "current",
      validityStatus: "valid",
      envelope: {
        semanticActor: { kind: "subject", id: "G" },
        producer: { kind: "model", id: "test" },
        committer: { kind: "runtime", id: "test" },
        authority: "subject_authorized",
        scope: {
          userId: user.id,
          subjectId: "G",
          applicability: "global",
          conversationId: null,
          pathHeadMessageId: null,
          visibility: "subject_private",
          sensitivity: "normal",
          audience: ["G"],
        },
        status: {
          generationStatus: "committed",
          presentationStatus: "presented",
          pathStatus: "current",
          settlementStatus: "settled",
          validityStatus: "valid",
        },
        provenance: {
          sources: [{
            kind: "message",
            id: retryFinalize.assistantMessageId,
          }],
          causedBy: retryFinalize.assistantMessageId,
          derivedFrom: [],
        },
        versions: {
          schemaVersion: 1,
          ruleVersion: "test",
          processVersion: "test",
        },
      },
    });

    const editRequestId =
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const edit = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: editRequestId,
      operation: "edit",
      conversation_id: conversation.id,
      target_user_message_id: secondUserId,
      text: "second edited",
    });
    assert.equal(edit.ok, true);
    if (!edit.ok) throw new Error("expected edit prepare success");
    assert.equal(edit.command.runtime_mode, "fork");
    assert.equal(
      edit.command.parent_provider_session_id,
      "provider-first",
    );
    assert.notEqual(edit.command.canonical_user_message_id, secondUserId);

    const editedUserId = edit.command.canonical_user_message_id;
    const editFinalize = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: edit.command.prepare_id,
      request_id: editRequestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-edit",
      normalized_events: [
        { type: "text", payload: { text: "edited answer" } },
        {
          type: "result",
          payload: { status: "success", final_text: "edited answer" },
        },
      ],
    });
    assert.equal(editFinalize.ok, true);
    if (!editFinalize.ok) throw new Error("expected edit finalize success");

    const afterEdit = await conversationService.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(afterEdit);
    const afterEditIds = new Set(afterEdit.messages.map((message) => message.id));
    assert.equal(afterEditIds.has(secondUserId), false);
    assert.equal(afterEditIds.has(retryFinalize.assistantMessageId), false);
    assert.equal(afterEditIds.has(editedUserId), true);
    assert.equal(afterEditIds.has(editFinalize.assistantMessageId), true);
    assert.equal(
      afterEdit.currentHeadMessageId,
      editFinalize.assistantMessageId,
    );

    const statesAfterEdit = await database.db
      .select({ id: runtimeSubjectStates.id })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, user.id));
    const stateIdsAfterEdit = new Set(statesAfterEdit.map((row) => row.id));
    assert.equal(stateIdsAfterEdit.has(retryCausalStateId), false);
    assert.equal(stateIdsAfterEdit.has(safeStateId), true);

    const providerCleanupsAfterEdit = await database.db
      .select({
        providerSessionId:
          nativeLiveProviderSessionCleanups.providerSessionId,
      })
      .from(nativeLiveProviderSessionCleanups)
      .where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
    assert.deepEqual(
      providerCleanupsAfterEdit.map((row) => row.providerSessionId).sort(),
      ["provider-retry", "provider-second"],
    );

    const failureRequestId =
      "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const failurePrepare = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: failureRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: editFinalize.assistantMessageId,
      text: "will fail",
    });
    assert.equal(failurePrepare.ok, true);
    if (!failurePrepare.ok) throw new Error("expected failure prepare success");

    const failureRuntimeMetadata = {
      context_usage: null,
      result: {
        subtype: "error_during_execution",
        is_error: true,
        duration_ms: 20,
        duration_api_ms: 15,
        num_turns: 1,
        queued_turn_count: 0,
        stop_reason: null,
        terminal_reason: "api_error",
        api_error_status: 529,
        startup_failure_reason: null,
        fast_mode_state: "off",
        fast_mode_disabled_reason: "overload",
        total_cost_usd: 0.01,
        origin: { kind: "user" },
        usage: { input_tokens: 1, output_tokens: 1 },
        modelUsage: {},
        permission_denials: [],
        errors: ["overloaded"],
        structured_output_present: false,
        deferred_tool_use_present: false,
        latency: {
          ttft_ms: null,
          ttft_stream_ms: null,
          time_to_request_ms: null,
          time_to_request_from_spawn_ms: null,
          time_origin_ms: null,
          warm_spare_claimed: null,
          first_content_frame_ms: null,
          first_stream_post_ms: null,
          first_stream_post_ack_ms: null,
          first_stream_post_wall_ms: null,
          first_text_post_ms: null,
          first_text_post_wall_ms: null,
          first_stream_post_queue_wait_ms: null,
          first_stream_post_queued_behind: null,
        },
      },
    };
    const failure = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: failurePrepare.command.prepare_id,
      request_id: failureRequestId,
      conversation_id: conversation.id,
      status: "failure",
      error_code: "CLAUDE_PROCESS_FAILED",
      runtime_metadata: failureRuntimeMetadata,
    });
    assert.equal(failure.ok, false);
    if (failure.ok) throw new Error("expected runtime failure result");
    assert.equal(failure.code, "CLAUDE_PROCESS_FAILED");

    const preparations = await database.db
      .select({
        operation: nativeLiveTurnPreparations.operation,
        status: nativeLiveTurnPreparations.status,
        runtimeMetadata:
          nativeLiveTurnPreparations.runtimeMetadata,
      })
      .from(nativeLiveTurnPreparations)
      .where(eq(nativeLiveTurnPreparations.userId, user.id));

    assert.equal(
      preparations.some((row) =>
        row.operation === "retry" && row.status === "finalized_success"
      ),
      false,
      "Edit purge must cascade the superseded Retry preparation",
    );
    assert.equal(
      preparations.some((row) =>
        row.operation === "edit" && row.status === "finalized_success"
      ),
      true,
    );
    assert.equal(
      preparations.some((row) => row.status === "finalized_failure"),
      true,
    );
    assert.deepEqual(
      preparations.find(
        (row) => row.status === "finalized_failure",
      )?.runtimeMetadata,
      failureRuntimeMetadata,
    );
  },
);


test(
  "Workspace execution binding persists one durable cwd authority and rejects ambiguous legacy membership",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    const suffix = crypto.randomUUID();
    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-workspace-${suffix}@example.com`,
        displayName: "Native Live Workspace",
      })
      .returning({ id: users.id });
    assert.ok(user);

    t.after(async () => {
      try {
        await database.db
          .delete(workspaces)
          .where(eq(workspaces.userId, user.id));
        await database.db
          .delete(nativeLiveProviderSessionCleanups)
          .where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
        await database.db
          .delete(conversations)
          .where(eq(conversations.userId, user.id));
        await database.db.delete(users).where(eq(users.id, user.id));
      } finally {
        await database.close();
      }
    });

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const boundConversation =
      await conversationService.createConversation({
        userId: user.id,
        title: "Workspace-bound conversation",
      });

    const [workspace] = await database.db
      .insert(workspaces)
      .values({
        userId: user.id,
        name: "Execution Workspace",
      })
      .returning({ id: workspaces.id });
    assert.ok(workspace);

    await database.db.insert(workspaceConversations).values({
      userId: user.id,
      workspaceId: workspace.id,
      conversationId: boundConversation.id,
    });

    const coordinator = new NativeLiveBackendTurnCoordinator(
      new DrizzleNativeLiveBackendTurnPort(database.db),
      () => crypto.randomUUID(),
    );

    const firstRequestId = crypto.randomUUID();
    const first = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: firstRequestId,
      operation: "send",
      conversation_id: boundConversation.id,
      expected_head_message_id: null,
      text: "workspace hello",
    });
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error("expected Workspace prepare");
    assert.equal(first.command.runtime_mode, "new");
    assert.equal(first.command.workspace_id, workspace.id);
    assert.equal(first.command.expected_workspace_root, null);

    const root = "/Users/leilei/Projects/workspace-demo";
    const finalized = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: first.command.prepare_id,
      request_id: firstRequestId,
      conversation_id: boundConversation.id,
      status: "success",
      provider_session_id: "provider-workspace-first",
      workspace_id: workspace.id,
      effective_workspace_root: root,
      normalized_events: [
        { type: "text", payload: { text: "workspace answer" } },
        {
          type: "result",
          payload: {
            status: "success",
            final_text: "workspace answer",
          },
        },
      ],
    });
    assert.equal(finalized.ok, true);
    if (!finalized.ok) throw new Error("expected Workspace finalize");

    const checkpoint =
      await conversationService.getProviderCheckpointForHead({
        userId: user.id,
        conversationId: boundConversation.id,
        canonicalMessageId: finalized.assistantMessageId,
      });
    assert.ok(checkpoint);
    assert.equal(checkpoint.workspaceId, workspace.id);
    assert.equal(checkpoint.effectiveWorkspaceRoot, root);

    const second = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: crypto.randomUUID(),
      operation: "send",
      conversation_id: boundConversation.id,
      expected_head_message_id: finalized.assistantMessageId,
      text: "continue in same workspace",
    });
    assert.equal(second.ok, true);
    if (!second.ok) throw new Error("expected Workspace continuation");
    assert.equal(second.command.runtime_mode, "fork");
    assert.equal(
      second.command.parent_provider_session_id,
      "provider-workspace-first",
    );
    assert.equal(second.command.workspace_id, workspace.id);
    assert.equal(second.command.expected_workspace_root, root);

    const explicitConversation =
      await conversationService.createConversation({
        userId: user.id,
        title: "Explicit Workspace selection",
      });
    const explicitRequestId = crypto.randomUUID();
    const explicit = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: explicitRequestId,
      operation: "send",
      conversation_id: explicitConversation.id,
      expected_head_message_id: null,
      workspace_id: workspace.id,
      text: "explicit workspace hello",
    });
    assert.equal(explicit.ok, true);
    if (!explicit.ok) throw new Error("expected explicit Workspace prepare");
    assert.equal(explicit.command.workspace_id, workspace.id);
    assert.equal(explicit.command.runtime_mode, "new");

    const explicitMemberships = await database.db
      .select({ workspaceId: workspaceConversations.workspaceId })
      .from(workspaceConversations)
      .where(eq(workspaceConversations.conversationId, explicitConversation.id));
    assert.deepEqual(explicitMemberships, [{ workspaceId: workspace.id }]);

    const missingWorkspace = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: crypto.randomUUID(),
      operation: "send",
      conversation_id: (
        await conversationService.createConversation({
          userId: user.id,
          title: "Missing Workspace selection",
        })
      ).id,
      expected_head_message_id: null,
      workspace_id: "77777777-7777-4777-8777-777777777777",
      text: "must fail closed",
    });
    assert.equal(missingWorkspace.ok, false);
    if (missingWorkspace.ok) throw new Error("expected missing Workspace failure");
    assert.equal(missingWorkspace.code, "WORKSPACE_NOT_FOUND");

    const explicitFinalized = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: explicit.command.prepare_id,
      request_id: explicitRequestId,
      conversation_id: explicitConversation.id,
      status: "success",
      provider_session_id: "provider-explicit-workspace",
      workspace_id: workspace.id,
      effective_workspace_root: root,
      normalized_events: [
        { type: "text", payload: { text: "explicit answer" } },
        {
          type: "result",
          payload: {
            status: "success",
            final_text: "explicit answer",
          },
        },
      ],
    });
    assert.equal(explicitFinalized.ok, true);
    if (!explicitFinalized.ok) {
      throw new Error("expected explicit Workspace finalize");
    }

    const explicitMetadata =
      await new DrizzleNativeLiveConversationRuntimeMetadataReader(
        database.db,
      ).readLatest({
        userId: user.id,
        conversationId: explicitConversation.id,
      });
    assert.ok(explicitMetadata);
    assert.equal(explicitMetadata.workspaceId, workspace.id);
    assert.equal(explicitMetadata.effectiveWorkspaceRoot, root);
    assert.equal(
      explicitMetadata.sourceMessageId,
      explicitFinalized.assistantMessageId,
    );

    const [otherWorkspaceForConflict] = await database.db
      .insert(workspaces)
      .values({
        userId: user.id,
        name: "Conflicting Execution Workspace",
      })
      .returning({ id: workspaces.id });
    assert.ok(otherWorkspaceForConflict);

    const workspaceSwitch = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: crypto.randomUUID(),
      operation: "send",
      conversation_id: explicitConversation.id,
      expected_head_message_id: explicitFinalized.assistantMessageId,
      workspace_id: otherWorkspaceForConflict.id,
      text: "do not move cwd",
    });
    assert.equal(workspaceSwitch.ok, false);
    if (workspaceSwitch.ok) {
      throw new Error("expected Workspace binding conflict");
    }
    assert.equal(workspaceSwitch.code, "WORKSPACE_BINDING_CONFLICT");

    const ambiguousConversation =
      await conversationService.createConversation({
        userId: user.id,
        title: "Ambiguous legacy membership",
      });
    const [otherWorkspace] = await database.db
      .insert(workspaces)
      .values({
        userId: user.id,
        name: "Other Execution Workspace",
      })
      .returning({ id: workspaces.id });
    assert.ok(otherWorkspace);

    await database.db.insert(workspaceConversations).values([
      {
        userId: user.id,
        workspaceId: workspace.id,
        conversationId: ambiguousConversation.id,
      },
      {
        userId: user.id,
        workspaceId: otherWorkspace.id,
        conversationId: ambiguousConversation.id,
      },
    ]);

    const ambiguous = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: crypto.randomUUID(),
      operation: "send",
      conversation_id: ambiguousConversation.id,
      expected_head_message_id: null,
      text: "do not guess",
    });
    assert.equal(ambiguous.ok, false);
    if (ambiguous.ok) throw new Error("expected ambiguous Workspace failure");
    assert.equal(ambiguous.code, "WORKSPACE_BINDING_AMBIGUOUS");
  },
);


test(
  "external Claude session bootstrap forks the first LeileiOS turn without importing provider history",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");

    const database = createDatabase(databaseUrl, { ssl: false });
    const suffix = crypto.randomUUID();
    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-external-bootstrap-${suffix}@example.com`,
        displayName: "Native Live External Bootstrap",
      })
      .returning({ id: users.id });
    assert.ok(user);

    t.after(async () => {
      try {
        await database.db
          .delete(conversations)
          .where(eq(conversations.userId, user.id));
        await database.db.delete(users).where(eq(users.id, user.id));
      } finally {
        await database.close();
      }
    });

    const conversationService = new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    );
    const conversation = await conversationService.createConversation({
      userId: user.id,
      title: "Forked Claude session",
    });
    const sourceSessionId = "external-claude-session-source";
    const workspaceRoot = "/Users/leilei/Projects/leilei-os";

    await database.db.execute(sql`
      INSERT INTO native_live_conversation_provider_bootstraps (
        conversation_id,
        user_id,
        provider,
        source_provider_session_id,
        workspace_id,
        effective_workspace_root
      ) VALUES (
        ${conversation.id}::uuid,
        ${user.id}::uuid,
        'claude_code',
        ${sourceSessionId},
        NULL,
        ${workspaceRoot}
      )
    `);

    const before = await conversationService.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(before);
    assert.equal(before.currentHeadMessageId, null);
    assert.deepEqual(
      before.messages,
      [],
      "provider history must not be copied into the canonical ledger",
    );

    const port = new DrizzleNativeLiveBackendTurnPort(database.db);
    const coordinator = new NativeLiveBackendTurnCoordinator(
      port,
      () => crypto.randomUUID(),
    );
    const requestId = crypto.randomUUID();
    const prepared = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "continue from the Claude Code context",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) throw new Error("expected bootstrap prepare success");
    assert.equal(prepared.command.runtime_mode, "fork");
    assert.equal(
      prepared.command.parent_provider_session_id,
      sourceSessionId,
    );
    assert.equal(prepared.command.workspace_id, null);
    assert.equal(
      prepared.command.expected_workspace_root,
      workspaceRoot,
    );

    const afterPrepare = await conversationService.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(afterPrepare);
    assert.equal(afterPrepare.messages.length, 1);
    assert.equal(afterPrepare.messages[0]?.role, "user");
    assert.equal(
      afterPrepare.messages[0]?.id,
      prepared.command.canonical_user_message_id,
    );

    const finalized = await coordinator.finalize(user.id, {
      protocol_version: 3,
      prepare_id: prepared.command.prepare_id,
      request_id: requestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "leileios-forked-provider-session",
      workspace_id: null,
      effective_workspace_root: workspaceRoot,
      normalized_events: [
        {
          type: "text",
          payload: { text: "continued answer" },
        },
        {
          type: "result",
          payload: {
            status: "success",
            final_text: "continued answer",
          },
        },
      ],
    });
    assert.equal(finalized.ok, true);
    if (!finalized.ok) throw new Error("expected bootstrap finalize success");

    const afterFinalize = await conversationService.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(afterFinalize);
    assert.equal(afterFinalize.messages.length, 2);
    assert.deepEqual(
      afterFinalize.messages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.equal(
      afterFinalize.currentHeadMessageId,
      finalized.assistantMessageId,
    );

    const bootstrapRows = await database.db.execute<{
      source_provider_session_id: string;
      consumed_at: Date | null;
    }>(sql`
      SELECT source_provider_session_id, consumed_at
      FROM native_live_conversation_provider_bootstraps
      WHERE conversation_id = ${conversation.id}::uuid
        AND user_id = ${user.id}::uuid
    `);
    assert.equal(bootstrapRows.length, 1);
    assert.equal(
      bootstrapRows[0]?.source_provider_session_id,
      sourceSessionId,
    );
    assert.ok(
      bootstrapRows[0]?.consumed_at,
      "bootstrap must be consumed after the first successful fork",
    );

    const checkpoint =
      await conversationService.getProviderCheckpointForHead({
        userId: user.id,
        conversationId: conversation.id,
        canonicalMessageId: finalized.assistantMessageId,
      });
    assert.ok(checkpoint);
    assert.equal(
      checkpoint.providerSessionId,
      "leileios-forked-provider-session",
    );
    assert.notEqual(checkpoint.providerSessionId, sourceSessionId);
  },
);
