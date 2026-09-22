import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  nativeLiveTurnPreparations,
  conversations,
  users,
} from "../src/database/schema.js";
import {
  NativeLiveBackendTurnCoordinator,
} from "../src/domains/bridge/native-live-backend-turn-coordinator.js";
import {
  DrizzleNativeLiveBackendTurnPort,
} from "../src/domains/bridge/native-live-backend-turn-repository.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";

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

    const firstFinalize = await coordinator.finalize(user.id, {
      protocol_version: 1,
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
    });
    assert.equal(firstFinalize.ok, true);
    if (!firstFinalize.ok) throw new Error("expected first finalize success");
    assert.equal(firstFinalize.outcome, "completed");

    const finalizeReplay = await coordinator.finalize(user.id, {
      protocol_version: 1,
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
    });
    assert.equal(finalizeReplay.ok, true);
    if (!finalizeReplay.ok) throw new Error("expected idempotent finalize");
    assert.equal(finalizeReplay.outcome, "idempotent");
    assert.equal(
      finalizeReplay.assistantMessageId,
      firstFinalize.assistantMessageId,
    );

    const conflictingFinalize = await coordinator.finalize(user.id, {
      protocol_version: 1,
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

    const failure = await coordinator.finalize(user.id, {
      protocol_version: 1,
      prepare_id: secondPrepare.command.prepare_id,
      request_id: secondRequestId,
      conversation_id: conversation.id,
      status: "failure",
      error_code: "CLAUDE_PROCESS_FAILED",
    });
    assert.equal(failure.ok, false);
    if (failure.ok) throw new Error("expected runtime failure result");
    assert.equal(failure.code, "CLAUDE_PROCESS_FAILED");

    const failureReplay = await coordinator.finalize(user.id, {
      protocol_version: 1,
      prepare_id: secondPrepare.command.prepare_id,
      request_id: secondRequestId,
      conversation_id: conversation.id,
      status: "failure",
      error_code: "CLAUDE_PROCESS_FAILED",
    });
    assert.equal(failureReplay.ok, false);
    if (failureReplay.ok) throw new Error("expected failure replay result");
    assert.equal(failureReplay.code, "CLAUDE_PROCESS_FAILED");

    const afterFailure = await conversationService.getConversation({
      userId: user.id,
      conversationId: conversation.id,
    });
    assert.ok(afterFailure);
    assert.equal(afterFailure.messages.length, 3);
    assert.equal(
      afterFailure.currentHeadMessageId,
      firstFinalize.assistantMessageId,
    );

    const retryRequestId =
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const retry = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: retryRequestId,
      operation: "retry",
      conversation_id: conversation.id,
      target_user_message_id:
        secondPrepare.command.canonical_user_message_id,
    });
    assert.equal(retry.ok, true);
    if (!retry.ok) throw new Error("expected retry prepare success");
    assert.equal(retry.command.runtime_mode, "fork");
    assert.equal(
      retry.command.parent_provider_session_id,
      "provider-first",
    );
    assert.equal(retry.command.prompt, "second");

    const editRequestId =
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const edit = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: editRequestId,
      operation: "edit",
      conversation_id: conversation.id,
      target_user_message_id:
        secondPrepare.command.canonical_user_message_id,
      text: "second edited",
    });
    assert.equal(edit.ok, true);
    if (!edit.ok) throw new Error("expected edit prepare success");
    assert.equal(edit.command.runtime_mode, "fork");
    assert.equal(
      edit.command.parent_provider_session_id,
      "provider-first",
    );
    assert.notEqual(
      edit.command.canonical_user_message_id,
      secondPrepare.command.canonical_user_message_id,
    );

    const preparations = await database.db
      .select({
        status: nativeLiveTurnPreparations.status,
        mindPrepared: nativeLiveTurnPreparations.mindPrepared,
      })
      .from(nativeLiveTurnPreparations)
      .where(eq(nativeLiveTurnPreparations.userId, user.id));

    assert.equal(preparations.length, 4);
    assert.equal(
      preparations.filter((row) => row.status === "finalized_success").length,
      1,
    );
    assert.equal(
      preparations.filter((row) => row.status === "finalized_failure").length,
      1,
    );
    assert.equal(
      preparations.filter((row) => row.mindPrepared).length,
      1,
    );
  },
);
