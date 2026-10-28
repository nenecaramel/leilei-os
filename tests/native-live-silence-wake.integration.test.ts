import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  conversationMessages,
  nativeLiveTurnPreparations,
  nativeLiveProviderSessionCleanups,
  nativeLiveRuntimeListenerLeases,
  nativeLiveSilenceWakeReceipts,
  users,
} from "../src/database/schema.js";
import {
  DrizzleNativeLiveBackendRelayRepository,
  NativeLiveBackendRelayService,
} from "../src/domains/bridge/relay/native-live-backend-relay.js";
import {
  NativeLiveBackendTurnCoordinator,
} from "../src/domains/bridge/turn/native-live-backend-turn-coordinator.js";
import {
  DrizzleNativeLiveBackendTurnPort,
} from "../src/domains/bridge/turn/native-live-backend-turn-repository.js";
import {
  NativeLiveSilenceWakeService,
  silenceWakePreparationId,
} from "../src/domains/bridge/turn/native-live-silence-wake.js";
import {
  DrizzleNativeLiveConversationRepository,
} from "../src/domains/conversation/native-live-conversation-repository.js";
import {
  NativeLiveConversationService,
} from "../src/domains/conversation/native-live-conversation-service.js";

const enabled =
  process.env.RUN_NATIVE_LIVE_TURN_DATABASE_TEST === "1";

test(
  "silence wake keeps short/long slots independent, erases quiet work, and appends visible proactive assistant directly to the head",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });

    const [user] = await database.db
      .insert(users)
      .values({
        email:
          `native-live-silence-wake-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Silence Wake",
      })
      .returning({ id: users.id });
    assert.ok(user);

    t.after(async () => {
      try {
        await database.db
          .delete(nativeLiveProviderSessionCleanups)
          .where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
        await database.db
          .delete(conversations)
          .where(eq(conversations.userId, user.id));
        await database.db
          .delete(users)
          .where(eq(users.id, user.id));
      } finally {
        await database.close();
      }
    });

    const conversationService =
      new NativeLiveConversationService(
        new DrizzleNativeLiveConversationRepository(database.db),
      );
    const conversation =
      await conversationService.createConversation({
        userId: user.id,
        title: "Silence wake integration",
      });
    const port =
      new DrizzleNativeLiveBackendTurnPort(database.db);
    const coordinator =
      new NativeLiveBackendTurnCoordinator(
        port,
        () => crypto.randomUUID(),
      );

    const foregroundRequestId = crypto.randomUUID();
    const foreground = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: foregroundRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "hello",
    });
    assert.equal(foreground.ok, true);
    if (!foreground.ok) {
      throw new Error("expected foreground prepare success");
    }
    const sourceUserMessageId =
      foreground.command.canonical_user_message_id;
    assert.ok(sourceUserMessageId);

    const foregroundFinalized =
      await coordinator.finalize(user.id, {
        protocol_version: 4,
        prepare_id: foreground.command.prepare_id,
        request_id: foregroundRequestId,
        conversation_id: conversation.id,
        status: "success",
        provider_session_id: "provider-foreground",
        provider_checkpoint_id: foreground.command.prepare_id,
        normalized_events: [
          {
            type: "text",
            payload: { text: "foreground answer" },
          },
          {
            type: "result",
            payload: {
              status: "success",
              final_text: "foreground answer",
            },
          },
        ],
      });
    assert.equal(foregroundFinalized.ok, true);
    if (
      !foregroundFinalized.ok
      || foregroundFinalized.outcome !== "completed"
    ) {
      throw new Error("expected foreground finalize success");
    }
    const sourceAssistantMessageId =
      foregroundFinalized.assistantMessageId;

    let now = new Date();
    const silence = new NativeLiveSilenceWakeService(
      database.db,
      () => now,
    );
    const initialSchedule = await silence.readSchedule({
      userId: user.id,
    });
    assert.ok(initialSchedule);
    assert.equal(initialSchedule.epochId, sourceUserMessageId);
    assert.equal(initialSchedule.postTurnConsumed, false);
    assert.equal(initialSchedule.longIdleConsumed, false);

    now = new Date(initialSchedule.postTurnDueAt);
    const short = await silence.fire({
      userId: user.id,
      epochId: initialSchedule.epochId,
      slot: "post_turn_idle",
    });
    assert.equal(short.outcome, "queued");
    assert.equal(short.schedule?.postTurnConsumed, true);
    assert.equal(short.schedule?.longIdleConsumed, false);

    const shortPrepareId = silenceWakePreparationId(
      initialSchedule.epochId,
      "post_turn_idle",
    );
    const shortPreparation = await port.getPreparation({
      userId: user.id,
      prepareId: shortPrepareId,
    });
    assert.ok(shortPreparation);
    assert.equal(shortPreparation.operation, "wake");
    assert.equal(shortPreparation.runtimeMode, "fork");
    assert.equal(shortPreparation.parentProviderCheckpointId, foreground.command.prepare_id);
    assert.equal(shortPreparation.canonicalUserMessageId, null);
    assert.equal(
      shortPreparation.parentProviderSessionId,
      "provider-foreground",
    );
    assert.match(
      shortPreparation.prompt,
      /^\[wake · \+\d+m · no reply\]$/u,
    );

    const quiet = await coordinator.finalize(user.id, {
      protocol_version: 4,
      prepare_id: shortPrepareId,
      request_id: shortPreparation.requestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-wake-quiet",
        provider_checkpoint_id: shortPrepareId,
      normalized_events: [
        {
          type: "text",
          payload: { text: "<quiet />" },
        },
        {
          type: "result",
          payload: {
            status: "success",
            final_text: "<quiet />",
          },
        },
      ],
    });
    assert.deepEqual(quiet, {
      ok: true,
      outcome: "wake_quiet",
      requestId: shortPreparation.requestId,
      operation: "wake",
      conversationId: conversation.id,
      providerSessionId: "provider-wake-quiet",
    });
    assert.equal(
      await port.getPreparation({
        userId: user.id,
        prepareId: shortPrepareId,
      }),
      null,
      "quiet wake must delete its preparation and cascaded runtime evidence",
    );

    const afterQuiet =
      await conversationService.getConversation({
        userId: user.id,
        conversationId: conversation.id,
      });
    assert.ok(afterQuiet);
    assert.equal(afterQuiet.messages.length, 2);
    assert.equal(
      afterQuiet.currentHeadMessageId,
      sourceAssistantMessageId,
    );

    const afterQuietSchedule =
      await silence.readSchedule({ userId: user.id });
    assert.ok(afterQuietSchedule);
    assert.equal(afterQuietSchedule.postTurnConsumed, true);
    assert.equal(afterQuietSchedule.midIdleConsumed, false);
    assert.equal(afterQuietSchedule.longIdleConsumed, false);

    // The 30–40 minute slot is its own receipt between the short and long slots.
    assert.ok(afterQuietSchedule.midIdleDueAt);
    now = new Date(afterQuietSchedule.midIdleDueAt);
    const mid = await silence.fire({
      userId: user.id,
      epochId: afterQuietSchedule.epochId,
      slot: "mid_idle",
    });
    assert.equal(mid.outcome, "queued");
    assert.equal(mid.schedule?.midIdleConsumed, true);
    assert.equal(mid.schedule?.longIdleConsumed, false);
    const midPrepareId = silenceWakePreparationId(
      afterQuietSchedule.epochId,
      "mid_idle",
    );
    const midPreparation = await port.getPreparation({
      userId: user.id,
      prepareId: midPrepareId,
    });
    assert.ok(midPreparation);
    assert.equal(midPreparation.operation, "wake");
    assert.match(midPreparation.prompt, /^\[wake · \+\d+m · no reply\]$/u);
    const midQuiet = await coordinator.finalize(user.id, {
      protocol_version: 4,
      prepare_id: midPrepareId,
      request_id: midPreparation.requestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-wake-quiet",
      provider_checkpoint_id: midPrepareId,
      normalized_events: [
        { type: "text", payload: { text: "<quiet />" } },
        { type: "result", payload: { status: "success", final_text: "<quiet />" } },
      ],
    });
    assert.equal(midQuiet.ok && midQuiet.outcome, "wake_quiet");
    const afterMid = await silence.fire({
      userId: user.id,
      epochId: afterQuietSchedule.epochId,
      slot: "mid_idle",
    });
    assert.equal(afterMid.outcome, "ignored");

    now = new Date(afterQuietSchedule.longIdleDueAt);
    const long = await silence.fire({
      userId: user.id,
      epochId: afterQuietSchedule.epochId,
      slot: "long_idle",
    });
    assert.equal(long.outcome, "queued");

    const longPrepareId = silenceWakePreparationId(
      afterQuietSchedule.epochId,
      "long_idle",
    );
    const longPreparation = await port.getPreparation({
      userId: user.id,
      prepareId: longPrepareId,
    });
    assert.ok(longPreparation);

    const visible = await coordinator.finalize(user.id, {
      protocol_version: 4,
      prepare_id: longPrepareId,
      request_id: longPreparation.requestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-wake-visible",
        provider_checkpoint_id: longPrepareId,
      normalized_events: [
        {
          type: "text",
          payload: { text: "还想补一句。" },
        },
        {
          type: "result",
          payload: {
            status: "success",
            final_text: "还想补一句。",
          },
        },
      ],
    });
    assert.equal(visible.ok, true);
    if (!visible.ok || visible.outcome !== "completed") {
      throw new Error("expected visible wake finalize success");
    }
    assert.equal(visible.operation, "wake");
    assert.equal(visible.userMessageId, null);

    const afterVisible =
      await conversationService.getConversation({
        userId: user.id,
        conversationId: conversation.id,
      });
    assert.ok(afterVisible);
    assert.equal(afterVisible.messages.length, 3);
    assert.equal(
      afterVisible.messages.filter((message) => message.role === "user")
        .length,
      1,
      "visible wake must not fabricate a canonical user message",
    );
    const proactive = afterVisible.messages.find(
      (message) => message.id === visible.assistantMessageId,
    );
    assert.ok(proactive);
    assert.equal(proactive.role, "assistant");
    assert.equal(
      proactive.parentMessageId,
      sourceAssistantMessageId,
      "proactive assistant continues directly from the current assistant head",
    );
    assert.equal(
      afterVisible.currentHeadMessageId,
      visible.assistantMessageId,
    );

    const checkpoint =
      await conversationService.getProviderCheckpointForHead({
        userId: user.id,
        conversationId: conversation.id,
        canonicalMessageId: visible.assistantMessageId,
      });
    assert.equal(
      checkpoint?.providerSessionId,
      "provider-wake-visible",
    );

    const receipts = await database.db
      .select({
        slot: nativeLiveSilenceWakeReceipts.slot,
      })
      .from(nativeLiveSilenceWakeReceipts)
      .where(eq(nativeLiveSilenceWakeReceipts.userId, user.id));
    assert.deepEqual(
      receipts.map((row) => row.slot).sort(),
      ["long_idle", "mid_idle", "post_turn_idle"],
    );

    const nextRequestId = crypto.randomUUID();
    const next = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: nextRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: visible.assistantMessageId,
      text: "new user activity",
    });
    assert.equal(next.ok, true);
    assert.equal(
      await silence.readSchedule({ userId: user.id }),
      null,
      "a new user message invalidates the previous silence epoch immediately",
    );
  },
);

test(
  "silence wake revalidates user activity before canonical write and discards an in-flight stale wake",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });

    const [user] = await database.db
      .insert(users)
      .values({
        email:
          `native-live-silence-stale-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Silence Wake Stale",
      })
      .returning({ id: users.id });
    assert.ok(user);

    t.after(async () => {
      try {
        await database.db
          .delete(nativeLiveProviderSessionCleanups)
          .where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
        await database.db
          .delete(conversations)
          .where(eq(conversations.userId, user.id));
        await database.db
          .delete(users)
          .where(eq(users.id, user.id));
      } finally {
        await database.close();
      }
    });

    const conversationService =
      new NativeLiveConversationService(
        new DrizzleNativeLiveConversationRepository(database.db),
      );
    const conversation =
      await conversationService.createConversation({
        userId: user.id,
        title: "Silence wake stale integration",
      });
    const port =
      new DrizzleNativeLiveBackendTurnPort(database.db);
    const coordinator =
      new NativeLiveBackendTurnCoordinator(
        port,
        () => crypto.randomUUID(),
      );

    const foregroundRequestId = crypto.randomUUID();
    const foreground = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: foregroundRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "first",
    });
    assert.equal(foreground.ok, true);
    if (!foreground.ok) {
      throw new Error("expected foreground prepare success");
    }
    const sourceUserMessageId =
      foreground.command.canonical_user_message_id;
    assert.ok(sourceUserMessageId);

    const foregroundFinalized =
      await coordinator.finalize(user.id, {
        protocol_version: 4,
        prepare_id: foreground.command.prepare_id,
        request_id: foregroundRequestId,
        conversation_id: conversation.id,
        status: "success",
        provider_session_id: "provider-stale-source",
        provider_checkpoint_id: foreground.command.prepare_id,
        normalized_events: [
          {
            type: "text",
            payload: { text: "first answer" },
          },
        ],
      });
    assert.equal(foregroundFinalized.ok, true);
    if (
      !foregroundFinalized.ok
      || foregroundFinalized.outcome !== "completed"
    ) {
      throw new Error("expected foreground finalize success");
    }

    let now = new Date();
    const silence = new NativeLiveSilenceWakeService(
      database.db,
      () => now,
    );
    const schedule =
      await silence.readSchedule({ userId: user.id });
    assert.ok(schedule);
    now = new Date(schedule.postTurnDueAt);

    const fired = await silence.fire({
      userId: user.id,
      epochId: schedule.epochId,
      slot: "post_turn_idle",
    });
    assert.equal(fired.outcome, "queued");

    const wakePrepareId = silenceWakePreparationId(
      schedule.epochId,
      "post_turn_idle",
    );
    const wakePreparation = await port.getPreparation({
      userId: user.id,
      prepareId: wakePrepareId,
    });
    assert.ok(wakePreparation);

    const nextRequestId = crypto.randomUUID();
    const next = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: nextRequestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id:
        foregroundFinalized.assistantMessageId,
      text: "I replied while wake was running",
    });
    assert.equal(next.ok, true);

    const stale = await coordinator.finalize(user.id, {
      protocol_version: 4,
      prepare_id: wakePrepareId,
      request_id: wakePreparation.requestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-stale-wake-child",
        provider_checkpoint_id: wakePrepareId,
      normalized_events: [
        {
          type: "text",
          payload: { text: "This must never be written." },
        },
      ],
    });
    assert.deepEqual(stale, {
      ok: true,
      outcome: "wake_stale",
      requestId: wakePreparation.requestId,
      operation: "wake",
      conversationId: conversation.id,
      providerSessionId: "provider-stale-wake-child",
    });
    assert.equal(
      await port.getPreparation({
        userId: user.id,
        prepareId: wakePrepareId,
      }),
      null,
    );

    const after =
      await conversationService.getConversation({
        userId: user.id,
        conversationId: conversation.id,
      });
    assert.ok(after);
    assert.equal(
      after.messages.some((message) =>
        message.blocks.some((block) =>
          block.kind === "text"
          && block.text === "This must never be written."
        )
      ),
      false,
    );
    assert.equal(
      after.currentHeadMessageId,
      foregroundFinalized.assistantMessageId,
      "the unfinalized newer user turn does not let the stale wake advance the head",
    );

    const cleanups = await database.db
      .select({
        providerSessionId:
          nativeLiveProviderSessionCleanups.providerSessionId,
      })
      .from(nativeLiveProviderSessionCleanups)
      .where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
    assert.deepEqual(
      cleanups.map((row) => row.providerSessionId),
      ["provider-stale-wake-child"],
    );

    assert.equal(
      await silence.readSchedule({ userId: user.id }),
      null,
      "the new user activity invalidates the old epoch before it receives a reply",
    );
  },
);

test(
  "silence wake ignores stranded staged work older than its source assistant while fresh staged intent still blocks",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });

    const [user] = await database.db
      .insert(users)
      .values({
        email:
          `native-live-silence-stranded-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Silence Wake Stranded",
      })
      .returning({ id: users.id });
    assert.ok(user);

    t.after(async () => {
      try {
        await database.db
          .delete(nativeLiveRuntimeListenerLeases)
          .where(eq(nativeLiveRuntimeListenerLeases.userId, user.id));
        await database.db
          .delete(nativeLiveProviderSessionCleanups)
          .where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
        await database.db
          .delete(conversations)
          .where(eq(conversations.userId, user.id));
        await database.db
          .delete(users)
          .where(eq(users.id, user.id));
      } finally {
        await database.close();
      }
    });

    const conversationService =
      new NativeLiveConversationService(
        new DrizzleNativeLiveConversationRepository(database.db),
      );
    const strandedConversation =
      await conversationService.createConversation({
        userId: user.id,
        title: "Stranded staged foreground",
      });
    const sourceConversation =
      await conversationService.createConversation({
        userId: user.id,
        title: "Current silence source",
      });
    const port =
      new DrizzleNativeLiveBackendTurnPort(database.db);
    const coordinator =
      new NativeLiveBackendTurnCoordinator(
        port,
        () => crypto.randomUUID(),
      );

    const stranded = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: crypto.randomUUID(),
      operation: "send",
      conversation_id: strandedConversation.id,
      expected_head_message_id: null,
      text: "old turn that never left staged",
    });
    assert.equal(stranded.ok, true);
    if (!stranded.ok) {
      throw new Error("expected stranded prepare success");
    }

    // Make "older stranded work" an explicit fixture fact, not a millisecond
    // timestamp tie resolved by random UUID order in the latest-user query.
    const strandedAt = new Date(Date.now() - 60_000);
    await database.db.update(conversationMessages).set({ createdAt: strandedAt })
      .where(eq(conversationMessages.id, stranded.command.canonical_user_message_id!));
    await database.db.update(nativeLiveTurnPreparations).set({ createdAt: strandedAt })
      .where(eq(nativeLiveTurnPreparations.id, stranded.command.prepare_id));

    const sourceRequestId = crypto.randomUUID();
    const source = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: sourceRequestId,
      operation: "send",
      conversation_id: sourceConversation.id,
      expected_head_message_id: null,
      text: "newer completed turn",
    });
    assert.equal(source.ok, true);
    if (!source.ok) {
      throw new Error("expected source prepare success");
    }
    const sourceUserMessageId =
      source.command.canonical_user_message_id;
    assert.ok(sourceUserMessageId);

    const sourceFinalized = await coordinator.finalize(user.id, {
      protocol_version: 4,
      prepare_id: source.command.prepare_id,
      request_id: sourceRequestId,
      conversation_id: sourceConversation.id,
      status: "success",
      provider_session_id: "provider-current-source",
        provider_checkpoint_id: source.command.prepare_id,
      normalized_events: [
        {
          type: "text",
          payload: { text: "current answer" },
        },
        {
          type: "result",
          payload: {
            status: "success",
            final_text: "current answer",
          },
        },
      ],
    });
    assert.equal(sourceFinalized.ok, true);
    if (
      !sourceFinalized.ok
      || sourceFinalized.outcome !== "completed"
    ) {
      throw new Error("expected source finalize success");
    }

    let now = new Date();
    const silence = new NativeLiveSilenceWakeService(
      database.db,
      () => now,
    );
    const schedule =
      await silence.readSchedule({ userId: user.id });
    assert.ok(schedule);
    assert.equal(schedule.epochId, sourceUserMessageId);

    now = new Date(schedule.postTurnDueAt);
    const short = await silence.fire({
      userId: user.id,
      epochId: schedule.epochId,
      slot: "post_turn_idle",
    });
    assert.equal(short.outcome, "queued");

    const shortPrepareId = silenceWakePreparationId(
      schedule.epochId,
      "post_turn_idle",
    );
    const relay = new NativeLiveBackendRelayService(
      new DrizzleNativeLiveBackendRelayRepository(database.db),
      coordinator,
    );
    const listenerId = crypto.randomUUID();
    assert.equal(
      await relay.renewLease({
        userId: user.id,
        listenerInstanceId: listenerId,
        dispatchTarget: "claude_code",
      }),
      "acquired",
    );
    const reserved = await relay.reserveNext({
      userId: user.id,
      listenerInstanceId: listenerId,
      dispatchTarget: "claude_code",
      persistentSessions: true,
    });
    assert.ok(reserved);
    assert.equal(
      reserved.reservationId,
      shortPrepareId,
      "an older stranded staged row must not cancel the queued wake",
    );

    await relay.markExecutionStarted({
      userId: user.id,
      listenerInstanceId: listenerId,
      reservationId: shortPrepareId,
    });
    const shortPreparation = await port.getPreparation({
      userId: user.id,
      prepareId: shortPrepareId,
    });
    assert.ok(shortPreparation);
    assert.equal(shortPreparation.runtimeMode, "resume", "modern Wake must retain its original session");
    const quiet = await relay.submitResult({
      userId: user.id,
      listenerInstanceId: listenerId,
      reservationId: shortPrepareId,
      result: {
        protocol_version: 4,
        prepare_id: shortPrepareId,
        request_id: shortPreparation.requestId,
        conversation_id: sourceConversation.id,
        status: "success",
        provider_session_id: "provider-current-source",
        provider_checkpoint_id: shortPrepareId,
        normalized_events: [
          {
            type: "text",
            payload: { text: "<quiet />" },
          },
          {
            type: "result",
            payload: {
              status: "success",
              final_text: "<quiet />",
            },
          },
        ],
      },
    });
    assert.equal(quiet.ok, true);
    if (!quiet.ok) throw new Error("expected quiet wake success");
    assert.equal(quiet.outcome, "wake_stale", "remaining staged intent suppresses visible Wake publication");
    assert.equal(quiet.nativeResumeCheckpointId, shortPrepareId,
      "same-session quiet completion still commits its cursor despite older staged work");

    const freshRetry = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: crypto.randomUUID(),
      operation: "retry",
      conversation_id: sourceConversation.id,
      target_user_message_id: sourceUserMessageId,
    });
    assert.equal(freshRetry.ok, true);
    if (!freshRetry.ok) {
      throw new Error("expected fresh retry prepare success");
    }

    const afterShort =
      await silence.readSchedule({ userId: user.id });
    assert.ok(afterShort);
    now = new Date(afterShort.longIdleDueAt);
    const long = await silence.fire({
      userId: user.id,
      epochId: afterShort.epochId,
      slot: "long_idle",
    });
    assert.deepEqual(long, {
      outcome: "ignored",
      reason: "foreground_active",
      schedule: null,
    });
  },
);

// After a daemon restart the Wake is often what reopens the native writer.
// It must open it with the model the owner last chose, or the next send
// (which carries that choice) cannot continue the writer the Wake opened.
test(
  "a silence wake carries the conversation's latest chosen execution selection",
  { skip: !enabled },
  async (t) => {
    const databaseUrl = process.env.DATABASE_URL;
    assert.ok(databaseUrl, "DATABASE_URL is required");
    const database = createDatabase(databaseUrl, { ssl: false });
    const [user] = await database.db
      .insert(users)
      .values({
        email: `native-live-wake-selection-${crypto.randomUUID()}@example.com`,
        displayName: "Native Live Wake Selection",
      })
      .returning({ id: users.id });
    assert.ok(user);
    t.after(async () => {
      try {
        await database.db.delete(nativeLiveProviderSessionCleanups).where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
        await database.db.delete(conversations).where(eq(conversations.userId, user.id));
        await database.db.delete(users).where(eq(users.id, user.id));
      } finally {
        await database.close();
      }
    });

    const conversation = await new NativeLiveConversationService(
      new DrizzleNativeLiveConversationRepository(database.db),
    ).createConversation({ userId: user.id, title: "Wake selection" });
    const port = new DrizzleNativeLiveBackendTurnPort(database.db);
    const coordinator = new NativeLiveBackendTurnCoordinator(port, () => crypto.randomUUID());
    const selection = { model: "claude-opus-5-5", thinking: "adaptive", effort: "high" } as const;

    const requestId = crypto.randomUUID();
    const send = await coordinator.prepare(user.id, {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: null,
      text: "hello",
      execution: selection,
    });
    assert.equal(send.ok, true);
    if (!send.ok) throw new Error("expected send prepare success");
    assert.deepEqual(send.command.execution_selection, selection);
    const finalized = await coordinator.finalize(user.id, {
      protocol_version: 4,
      prepare_id: send.command.prepare_id,
      request_id: requestId,
      conversation_id: conversation.id,
      status: "success",
      provider_session_id: "provider-selection",
      provider_checkpoint_id: send.command.prepare_id,
      normalized_events: [
        { type: "text", payload: { text: "answer" } },
        { type: "result", payload: { status: "success", final_text: "answer" } },
      ],
    });
    assert.equal(finalized.ok, true);

    let now = new Date();
    const silence = new NativeLiveSilenceWakeService(database.db, () => now);
    const schedule = await silence.readSchedule({ userId: user.id });
    assert.ok(schedule);
    now = new Date(schedule.postTurnDueAt);
    const fired = await silence.fire({ userId: user.id, epochId: schedule.epochId, slot: "post_turn_idle" });
    assert.equal(fired.outcome, "queued");
    const wake = await port.getPreparation({
      userId: user.id,
      prepareId: silenceWakePreparationId(schedule.epochId, "post_turn_idle"),
    });
    assert.ok(wake);
    assert.equal(wake.operation, "wake");
    assert.deepEqual(wake.executionSelection, selection);
  },
);
