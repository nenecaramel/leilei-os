import { syncTestNativeSessionOwner } from "./helpers/native-session-turn.js";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  conversations,
  nativeLiveConcerns,
  nativeLiveProviderSessionCleanups,
  users,
} from "../src/database/schema.js";
import {
  NativeLiveConcernError,
  NativeLiveConcernService,
} from "../src/domains/bridge/concern/native-live-concern.js";
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

const minute = 60_000;

async function harness(t: TestContext) {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required");
  const database = createDatabase(databaseUrl, { ssl: false });
  const [user] = await database.db
    .insert(users)
    .values({
      email: `native-live-concern-${crypto.randomUUID()}@example.com`,
      displayName: "Native Live Concern",
    })
    .returning({ id: users.id });
  assert.ok(user);
  t.after(async () => {
    try {
      await database.db.delete(nativeLiveProviderSessionCleanups)
        .where(eq(nativeLiveProviderSessionCleanups.userId, user.id));
      await database.db.delete(conversations).where(eq(conversations.userId, user.id));
      await database.db.delete(users).where(eq(users.id, user.id));
    } finally {
      await database.close();
    }
  });

  const conversationService = new NativeLiveConversationService(
    new DrizzleNativeLiveConversationRepository(database.db),
  );
  const port = new DrizzleNativeLiveBackendTurnPort(database.db);
  const coordinator = new NativeLiveBackendTurnCoordinator(port, () => crypto.randomUUID());
  const clock = { now: new Date() };
  const silence = new NativeLiveSilenceWakeService(database.db, () => clock.now);
  const concerns = new NativeLiveConcernService(database.db, () => clock.now);

  async function finalizeText(input: {
    prepareId: string;
    requestId: string;
    conversationId: string;
    providerSessionId: string;
    text: string;
  }) {
    const finalized = await coordinator.finalize(user!.id, {
      protocol_version: 4,
      prepare_id: input.prepareId,
      request_id: input.requestId,
      conversation_id: input.conversationId,
      status: "success",
      provider_session_id: input.providerSessionId,
      provider_checkpoint_id: input.prepareId,
      normalized_events: [
        { type: "text", payload: { text: input.text } },
        { type: "result", payload: { status: "success", final_text: input.text } },
      ],
    });
    assert.equal(finalized.ok, true, JSON.stringify(finalized));
    if (!finalized.ok) throw new Error("finalize failed");
    return finalized;
  }

  async function turn(input: {
    conversationId: string;
    expectedHead: string | null;
    text: string;
    reply: string;
  }) {
    const requestId = crypto.randomUUID();
    const prepared = await coordinator.prepare(user!.id, {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "send",
      conversation_id: input.conversationId,
      expected_head_message_id: input.expectedHead,
      text: input.text,
    });
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    if (!prepared.ok) throw new Error("prepare failed");
    // A resumed turn continues its parent native session.
    const providerSessionId = prepared.command.runtime_mode === "resume"
      ? prepared.command.parent_provider_session_id!
      : `provider-${prepared.command.prepare_id}`;
    const finalized = await finalizeText({
      prepareId: prepared.command.prepare_id,
      requestId,
      conversationId: input.conversationId,
      providerSessionId,
      text: input.reply,
    });
    if (finalized.outcome !== "completed") throw new Error("expected completed turn");
    return {
      userMessageId: prepared.command.canonical_user_message_id!,
      assistantMessageId: finalized.assistantMessageId,
      providerSessionId,
    };
  }

  async function newConversation(title: string) {
    return conversationService.createConversation({ userId: user!.id, title });
  }

  return {
    database, user, clock, silence, concerns, port, coordinator,
    conversationService, turn, finalizeText, newConversation,
  };
}

test(
  "a due concern wakes the same session once, survives a visible reply and can be postponed",
  { skip: !enabled },
  async (t) => {
    const h = await harness(t);
    const conversation = await h.newConversation("Concern wake");
    const source = await h.turn({
      conversationId: conversation.id, expectedHead: null,
      text: "我下午两点面试", reply: "加油",
    });
    h.clock.now = new Date();
    const created = await h.concerns.create({
      userId: h.user.id,
      content: "惦记他今天面试的结果",
      reason: "他下午两点面试",
      considerInMinutes: 180,
      expiresAt: new Date(h.clock.now.getTime() + 24 * 60 * minute).toISOString(),
    });
    assert.equal(created.replayed, false);
    const concernId = created.concern.id;

    const retried = await h.concerns.create({
      userId: h.user.id,
      content: "惦记他今天面试的结果",
      considerInMinutes: 180,
      expiresAt: new Date(h.clock.now.getTime() + 24 * 60 * minute).toISOString(),
    });
    assert.equal(retried.replayed, true, "a retried create must not double-record");
    assert.equal(retried.concern.id, concernId);

    const schedule = await h.silence.readSchedule({ userId: h.user.id });
    assert.ok(schedule?.concernDueAt);
    assert.equal(
      Date.parse(schedule.concernDueAt),
      h.clock.now.getTime() + 180 * minute,
    );

    // Both fixed slots fire first and neither carries the not-yet-due concern.
    for (const slot of ["post_turn_idle", "long_idle"] as const) {
      const current = await h.silence.readSchedule({ userId: h.user.id });
      assert.ok(current);
      h.clock.now = new Date(slot === "post_turn_idle" ? current.postTurnDueAt : current.longIdleDueAt);
      const fired = await h.silence.fire({ userId: h.user.id, epochId: current.epochId, slot });
      assert.equal(fired.outcome, "queued");
      const prepareId = silenceWakePreparationId(current.epochId, slot);
      const preparation = await h.port.getPreparation({ userId: h.user.id, prepareId });
      assert.ok(preparation);
      assert.doesNotMatch(preparation.prompt, /concern/u);
      const quiet = await h.finalizeText({
        prepareId, requestId: preparation.requestId, conversationId: conversation.id,
        providerSessionId: `provider-quiet-${slot}`, text: "<quiet />",
      });
      assert.equal(quiet.outcome, "wake_quiet");
    }

    const beforeConcern = await h.silence.readSchedule({ userId: h.user.id });
    assert.ok(beforeConcern?.concernDueAt);
    h.clock.now = new Date(Date.parse(beforeConcern.concernDueAt) - 1_000);
    assert.equal(
      (await h.silence.fire({ userId: h.user.id, epochId: beforeConcern.epochId, slot: "concern" })).outcome,
      "ignored",
      "an early concern fire is rejected by the server clock",
    );
    h.clock.now = new Date(beforeConcern.concernDueAt);
    const fired = await h.silence.fire({
      userId: h.user.id, epochId: beforeConcern.epochId, slot: "concern",
    });
    assert.equal(fired.outcome, "queued");
    assert.equal(fired.schedule?.concernDueAt, null);

    const duplicate = await h.silence.fire({
      userId: h.user.id, epochId: beforeConcern.epochId, slot: "concern",
    });
    assert.deepEqual(
      { outcome: duplicate.outcome, reason: "reason" in duplicate ? duplicate.reason : null },
      { outcome: "ignored", reason: "slot_not_due" },
      "a repeated fire event never queues a second wake",
    );

    const prepareId = silenceWakePreparationId(beforeConcern.epochId, "concern_1");
    const preparation = await h.port.getPreparation({ userId: h.user.id, prepareId });
    assert.ok(preparation);
    assert.equal(preparation.operation, "wake");
    assert.equal(
      preparation.parentProviderSessionId,
      source.providerSessionId,
      "quiet forks leave the source session untouched",
    );
    assert.match(preparation.prompt, /^\[wake · \+\d+h \d+m · no reply\]\n\[concern · id=/u);
    assert.match(preparation.prompt, new RegExp(`id=${concernId} · expected_revision=1 · woken 1/3`, "u"));
    assert.match(preparation.prompt, /惦记他今天面试的结果\nreason: 他下午两点面试/u);
    assert.equal(preparation.wakeContext?.slot, "concern_1");
    assert.deepEqual(preparation.wakeContext?.concerns, [{ id: concernId, revision: 1 }]);

    const [row] = await h.database.db.select().from(nativeLiveConcerns)
      .where(eq(nativeLiveConcerns.id, concernId));
    assert.equal(row?.wakeCount, 1);
    assert.equal(row?.revision, 1, "program execution records never bump the model revision");

    const visible = await h.finalizeText({
      prepareId, requestId: preparation.requestId, conversationId: conversation.id,
      providerSessionId: "provider-concern-visible", text: "面试怎么样了？",
    });
    assert.equal(visible.outcome, "completed");
    if (visible.outcome !== "completed") throw new Error("expected visible wake");
    const afterVisible = await h.conversationService.getConversation({
      userId: h.user.id, conversationId: conversation.id,
    });
    assert.equal(afterVisible?.currentHeadMessageId, visible.assistantMessageId);
    const checkpoint = await h.conversationService.getProviderCheckpointForHead({
      userId: h.user.id, conversationId: conversation.id, canonicalMessageId: visible.assistantMessageId,
    });
    assert.equal(checkpoint?.providerSessionId, "provider-concern-visible");

    // Claude postpones: the moved time is eligible again after the cooldown.
    const postponed = await h.concerns.update({
      userId: h.user.id, concernId, expectedRevision: 1,
      considerInMinutes: 60, progress: "已经问过一次",
    });
    assert.equal(postponed.revision, 2);
    const afterPostpone = await h.silence.readSchedule({ userId: h.user.id });
    assert.equal(afterPostpone?.concernDueAt, new Date(h.clock.now.getTime() + 60 * minute).toISOString());
    h.clock.now = new Date(afterPostpone!.concernDueAt!);
    const second = await h.silence.fire({ userId: h.user.id, epochId: beforeConcern.epochId, slot: "concern" });
    assert.equal(second.outcome, "queued");
    const secondPreparation = await h.port.getPreparation({
      userId: h.user.id, prepareId: silenceWakePreparationId(beforeConcern.epochId, "concern_2"),
    });
    assert.match(secondPreparation?.prompt ?? "", /progress: 已经问过一次/u);
    assert.equal(secondPreparation?.parentProviderSessionId, "provider-concern-visible");
    await h.finalizeText({
      prepareId: secondPreparation!.prepareId, requestId: secondPreparation!.requestId,
      conversationId: conversation.id, providerSessionId: "provider-concern-quiet", text: "<quiet />",
    });

    // Later chat continues from the persisted proactive reply.
    const next = await h.turn({
      conversationId: conversation.id, expectedHead: visible.assistantMessageId,
      text: "过了，下周入职", reply: "太好了",
    });
    assert.ok(next.assistantMessageId);
    const released = await h.concerns.release({
      userId: h.user.id, concernId, expectedRevision: 2, outcome: "resolved",
    });
    assert.equal(released.status, "released");
    assert.equal((await h.silence.readSchedule({ userId: h.user.id }))?.concernDueAt, null);
  },
);

test(
  "a concern carried by a fixed wake is not triggered again",
  { skip: !enabled },
  async (t) => {
    const h = await harness(t);
    const conversation = await h.newConversation("Concern carried");
    await h.turn({ conversationId: conversation.id, expectedHead: null, text: "记得提醒我吃药", reply: "好" });
    h.clock.now = new Date();
    const { concern } = await h.concerns.create({
      // Due before the 2–5 minute reply wake, which therefore carries it.
      userId: h.user.id, content: "提醒吃药", considerInMinutes: 2,
      expiresAt: new Date(h.clock.now.getTime() + 6 * 60 * minute).toISOString(),
    });
    const schedule = await h.silence.readSchedule({ userId: h.user.id });
    assert.ok(schedule);
    assert.equal(schedule.concernDueAt, null, "the imminent short wake will carry it");

    h.clock.now = new Date(Math.max(Date.parse(schedule.postTurnDueAt), Date.parse(concern.consider_at)));
    const fired = await h.silence.fire({ userId: h.user.id, epochId: schedule.epochId, slot: "post_turn_idle" });
    assert.equal(fired.outcome, "queued");
    assert.equal(fired.schedule?.concernDueAt, null);
    const short = await h.port.getPreparation({
      userId: h.user.id, prepareId: silenceWakePreparationId(schedule.epochId, "post_turn_idle"),
    });
    assert.match(short?.prompt ?? "", /^\[wake · \+\d+m · no reply\]\n\[concern · id=/u);
    await h.finalizeText({
      prepareId: short!.prepareId, requestId: short!.requestId, conversationId: conversation.id,
      providerSessionId: "provider-short", text: "<quiet />",
    });

    h.clock.now = new Date(schedule.longIdleDueAt);
    const long = await h.silence.fire({ userId: h.user.id, epochId: schedule.epochId, slot: "long_idle" });
    assert.equal(long.outcome, "queued");
    const longPreparation = await h.port.getPreparation({
      userId: h.user.id, prepareId: silenceWakePreparationId(schedule.epochId, "long_idle"),
    });
    assert.doesNotMatch(longPreparation?.prompt ?? "", /concern/u);
    assert.equal(long.schedule?.concernDueAt, null);
  },
);

test(
  "edits are revision fenced, concurrent writers cannot both win, and release or expiry ends a concern",
  { skip: !enabled },
  async (t) => {
    const h = await harness(t);
    const conversation = await h.newConversation("Concern fence");
    await h.turn({ conversationId: conversation.id, expectedHead: null, text: "明天体检", reply: "好" });
    h.clock.now = new Date();
    const expiresAt = new Date(h.clock.now.getTime() + 24 * 60 * minute).toISOString();
    const { concern } = await h.concerns.create({
      userId: h.user.id, content: "体检结果", considerInMinutes: 600, expiresAt,
    });

    const racing = await Promise.allSettled([
      h.concerns.update({ userId: h.user.id, concernId: concern.id, expectedRevision: 1, considerInMinutes: 30 }),
      h.concerns.update({ userId: h.user.id, concernId: concern.id, expectedRevision: 1, considerInMinutes: 900 }),
    ]);
    assert.equal(racing.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = racing.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && rejected.reason instanceof NativeLiveConcernError);
    assert.equal(rejected.reason.code, "STALE_REVISION");

    await assert.rejects(
      h.concerns.release({ userId: h.user.id, concernId: concern.id, expectedRevision: 1, outcome: "dropped" }),
      (error) => error instanceof NativeLiveConcernError && error.code === "STALE_REVISION",
    );
    const released = await h.concerns.release({
      userId: h.user.id, concernId: concern.id, expectedRevision: 2, outcome: "dropped",
    });
    assert.equal(released.release_reason, "dropped");
    await assert.rejects(
      h.concerns.update({ userId: h.user.id, concernId: concern.id, expectedRevision: 3, content: "again" }),
      (error) => error instanceof NativeLiveConcernError && error.code === "CONCERN_NOT_ACTIVE",
    );
    assert.equal((await h.silence.readSchedule({ userId: h.user.id }))?.concernDueAt, null);

    const brief = await h.concerns.create({
      userId: h.user.id, content: "短暂的牵挂", considerInMinutes: 5,
      expiresAt: new Date(h.clock.now.getTime() + 20 * minute).toISOString(),
    });
    assert.equal((await h.concerns.list({ userId: h.user.id })).concerns.length, 1);
    h.clock.now = new Date(h.clock.now.getTime() + 21 * minute);
    assert.deepEqual((await h.concerns.list({ userId: h.user.id })).concerns, []);
    assert.equal((await h.silence.readSchedule({ userId: h.user.id }))?.concernDueAt, null);
    await assert.rejects(
      h.concerns.update({ userId: h.user.id, concernId: brief.concern.id, expectedRevision: 1, considerInMinutes: 5 }),
      (error) => error instanceof NativeLiveConcernError && error.code === "CONCERN_NOT_ACTIVE",
    );

    for (let index = 0; index < 12; index += 1) {
      await h.concerns.create({
        userId: h.user.id, content: `牵挂 ${index}`, considerInMinutes: 60,
        expiresAt: new Date(h.clock.now.getTime() + 24 * 60 * minute).toISOString(),
      });
    }
    await assert.rejects(
      h.concerns.create({
        userId: h.user.id, content: "第十三条", considerInMinutes: 60,
        expiresAt: new Date(h.clock.now.getTime() + 24 * 60 * minute).toISOString(),
      }),
      (error) => error instanceof NativeLiveConcernError && error.code === "CONCERN_LIMIT_REACHED",
    );
    await assert.rejects(
      h.concerns.create({
        userId: h.user.id, content: "太远", considerInMinutes: 60,
        expiresAt: new Date(h.clock.now.getTime() + 8 * 24 * 60 * minute).toISOString(),
      }),
      (error) => error instanceof NativeLiveConcernError && error.code === "INVALID_CONCERN_WINDOW",
    );
  },
);

test(
  "concerns follow the current path: new turns keep them, Rewind, session switch and official handoff silence them",
  { skip: !enabled },
  async (t) => {
    const h = await harness(t);
    const conversation = await h.newConversation("Concern path");
    const opening = await h.turn({ conversationId: conversation.id, expectedHead: null, text: "在吗", reply: "在" });
    const first = await h.turn({
      conversationId: conversation.id, expectedHead: opening.assistantMessageId, text: "周五搬家", reply: "好",
    });
    h.clock.now = new Date();
    const { concern } = await h.concerns.create({
      userId: h.user.id, content: "搬家顺利吗", considerInMinutes: 300,
      expiresAt: new Date(h.clock.now.getTime() + 2 * 24 * 60 * minute).toISOString(),
    });

    // A later user turn starts a new epoch; the concern remains on its path.
    const second = await h.turn({
      conversationId: conversation.id, expectedHead: first.assistantMessageId, text: "今天好累", reply: "抱抱",
    });
    const kept = await h.silence.readSchedule({ userId: h.user.id });
    assert.equal(kept?.epochId, second.userMessageId);
    assert.ok(kept?.concernDueAt);

    // Official client handoff: the session is not LeileiOS's to wake.
    await h.database.db.execute(sql`
      UPDATE conversations
      SET provider_metadata = jsonb_set(coalesce(provider_metadata, '{}'::jsonb), '{nativeSessionSource}',
        coalesce(provider_metadata->'nativeSessionSource', '{}'::jsonb) || '{"owner":"desktop"}'::jsonb)
      WHERE id = ${conversation.id}::uuid
    `);
    await syncTestNativeSessionOwner(h.database.db, { userId: h.user.id, conversationId: conversation.id });
    assert.equal((await h.silence.readSchedule({ userId: h.user.id }))?.concernDueAt, null);
    await h.database.db.execute(sql`
      UPDATE conversations
      SET provider_metadata = provider_metadata #- '{nativeSessionSource,owner}'
      WHERE id = ${conversation.id}::uuid
    `);
    await syncTestNativeSessionOwner(h.database.db, { userId: h.user.id, conversationId: conversation.id });
    assert.ok((await h.silence.readSchedule({ userId: h.user.id }))?.concernDueAt);

    // Switching sessions leaves the concern dormant in its own conversation.
    const other = await h.newConversation("Concern other session");
    await h.turn({ conversationId: other.id, expectedHead: null, text: "换个话题", reply: "嗯" });
    const elsewhere = await h.silence.readSchedule({ userId: h.user.id });
    assert.equal(elsewhere?.conversationId, other.id);
    assert.equal(elsewhere?.concernDueAt, null);
    assert.deepEqual((await h.concerns.list({ userId: h.user.id })).concerns, []);

    // Back in the original session, then Rewind past the turn that kept it.
    await h.turn({
      conversationId: conversation.id, expectedHead: second.assistantMessageId, text: "回来了", reply: "嗯嗯",
    });
    assert.ok((await h.silence.readSchedule({ userId: h.user.id }))?.concernDueAt);
    const requestId = crypto.randomUUID();
    const edit = await h.coordinator.prepare(h.user.id, {
      dispatch_target: "claude_code",
      request_id: requestId,
      operation: "edit",
      conversation_id: conversation.id,
      target_user_message_id: first.userMessageId,
      text: "周五不搬了",
    });
    assert.equal(edit.ok, true, JSON.stringify(edit));
    if (!edit.ok) throw new Error("expected edit");
    await h.finalizeText({
      prepareId: edit.command.prepare_id, requestId, conversationId: conversation.id,
      // The edit rewinds its own session in place, as Desktop does.
      providerSessionId: edit.command.parent_provider_session_id!, text: "好的",
    });
    const rewound = await h.silence.readSchedule({ userId: h.user.id });
    assert.equal(rewound?.conversationId, conversation.id);
    assert.equal(rewound?.concernDueAt, null, "a rewound-away concern never wakes");
    assert.deepEqual((await h.concerns.list({ userId: h.user.id })).concerns, []);
    const [row] = await h.database.db.select().from(nativeLiveConcerns)
      .where(eq(nativeLiveConcerns.id, concern.id));
    assert.equal(row?.status, "active", "Rewind silences without rewriting Claude's own record");
  },
);

test(
  "a concern wake defers to an active foreground turn and respects the per-concern wake cap",
  { skip: !enabled },
  async (t) => {
    const h = await harness(t);
    const conversation = await h.newConversation("Concern foreground");
    const source = await h.turn({ conversationId: conversation.id, expectedHead: null, text: "晚点聊", reply: "好" });
    h.clock.now = new Date();
    const { concern } = await h.concerns.create({
      userId: h.user.id, content: "晚点继续聊", considerInMinutes: 200,
      expiresAt: new Date(h.clock.now.getTime() + 24 * 60 * minute).toISOString(),
    });
    const schedule = await h.silence.readSchedule({ userId: h.user.id });
    assert.ok(schedule?.concernDueAt);

    const staged = await h.coordinator.prepare(h.user.id, {
      dispatch_target: "claude_code",
      request_id: crypto.randomUUID(),
      operation: "send",
      conversation_id: conversation.id,
      expected_head_message_id: source.assistantMessageId,
      text: "我来了",
    });
    assert.equal(staged.ok, true);
    h.clock.now = new Date(schedule.concernDueAt);
    const blocked = await h.silence.fire({ userId: h.user.id, epochId: schedule.epochId, slot: "concern" });
    assert.equal(blocked.outcome, "ignored");
    const [row] = await h.database.db.select().from(nativeLiveConcerns)
      .where(eq(nativeLiveConcerns.id, concern.id));
    assert.equal(row?.wakeCount, 0, "a wake that never queued spends nothing");

    await h.database.db.update(nativeLiveConcerns)
      .set({ wakeCount: 3 })
      .where(eq(nativeLiveConcerns.id, concern.id));
    const capped = await h.concerns.list({ userId: h.user.id });
    assert.equal(capped.concerns[0]?.wake_count, 3);
    assert.equal(capped.concerns[0]?.max_wakes, 3);
  },
);

test(
  "after Mac sleep overdue concerns ride a single wake and expired ones are never replayed",
  { skip: !enabled },
  async (t) => {
    const h = await harness(t);
    const conversation = await h.newConversation("Concern sleep");
    await h.turn({ conversationId: conversation.id, expectedHead: null, text: "今天好多事", reply: "慢慢来" });
    h.clock.now = new Date();
    const base = h.clock.now.getTime();
    const day = new Date(base + 24 * 60 * minute).toISOString();
    const first = await h.concerns.create({ userId: h.user.id, content: "开会顺利吗", considerInMinutes: 200, expiresAt: day });
    const second = await h.concerns.create({ userId: h.user.id, content: "晚饭吃了吗", considerInMinutes: 230, expiresAt: day });
    await h.concerns.create({
      userId: h.user.id, content: "快递到了吗", considerInMinutes: 210,
      expiresAt: new Date(base + 220 * minute).toISOString(),
    });

    // The Mac slept through every deadline and wakes ten hours later.
    h.clock.now = new Date(base + 600 * minute);
    const schedule = await h.silence.readSchedule({ userId: h.user.id });
    assert.ok(schedule);
    const fired = await h.silence.fire({ userId: h.user.id, epochId: schedule.epochId, slot: "long_idle" });
    assert.equal(fired.outcome, "queued");
    const preparation = await h.port.getPreparation({
      userId: h.user.id, prepareId: silenceWakePreparationId(schedule.epochId, "long_idle"),
    });
    assert.deepEqual(
      (preparation?.wakeContext?.concerns as Array<{ id: string }>).map((concern) => concern.id),
      [first.concern.id, second.concern.id],
    );
    assert.doesNotMatch(preparation?.prompt ?? "", /快递到了吗/u);
    assert.equal(fired.schedule?.concernDueAt, null);
    assert.equal(
      (await h.silence.fire({ userId: h.user.id, epochId: schedule.epochId, slot: "concern" })).outcome,
      "ignored",
      "no catch-up wake follows the one that carried them",
    );
  },
);
