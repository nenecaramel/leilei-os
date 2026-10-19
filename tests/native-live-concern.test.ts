import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCERN_LIMITS,
  concernWakeDueAt,
  formatConcernWakeBlock,
  nextConcernWakeSlot,
} from "../src/domains/bridge/concern/native-live-concern.js";
import {
  chooseDueWakeFireSlot,
  nextSilenceWakeDeadline,
  silenceWakePreparationId,
  silenceWakeReceiptCandidatesForPreparationId,
  type NativeLiveSilenceWakeSchedule,
} from "../src/domains/bridge/turn/native-live-silence-wake.js";

const completedAt = new Date("2026-10-19T06:00:00.000Z");
const minute = 60_000;
const at = (offsetMinutes: number) =>
  new Date(completedAt.getTime() + offsetMinutes * minute);
const fixedConsumed = {
  postTurnDueAt: at(7).toISOString(),
  longIdleDueAt: at(100).toISOString(),
  postTurnConsumed: true,
  longIdleConsumed: true,
};

test("concern wake waits for its consider time and never fires right after a turn", () => {
  assert.deepEqual(
    concernWakeDueAt({
      pending: [{ considerAt: at(180), expiresAt: at(2000) }],
      receipts: [],
      fixed: fixedConsumed,
      assistantCompletedAt: completedAt,
    }),
    at(180),
  );
  assert.deepEqual(
    concernWakeDueAt({
      pending: [{ considerAt: at(1), expiresAt: at(2000) }],
      receipts: [],
      fixed: fixedConsumed,
      assistantCompletedAt: completedAt,
    }),
    at(CONCERN_LIMITS.postTurnGapMs / minute),
  );
});

test("every wake in the epoch opens a shared cooldown", () => {
  assert.deepEqual(
    concernWakeDueAt({
      pending: [{ considerAt: at(110), expiresAt: at(2000) }],
      receipts: [{ slot: "long_idle", consumedAt: at(100) }],
      fixed: fixedConsumed,
      assistantCompletedAt: completedAt,
    }),
    at(100 + CONCERN_LIMITS.cooldownMs / minute),
  );
});

test("a concern an imminent fixed wake will carry gets no wake of its own", () => {
  assert.equal(
    concernWakeDueAt({
      pending: [{ considerAt: at(90), expiresAt: at(2000) }],
      receipts: [{ slot: "post_turn_idle", consumedAt: at(7) }],
      fixed: { ...fixedConsumed, longIdleConsumed: false },
      assistantCompletedAt: completedAt,
    }),
    null,
  );
  // A fixed wake well after the concern does not delay it.
  assert.deepEqual(
    concernWakeDueAt({
      pending: [{ considerAt: at(40), expiresAt: at(2000) }],
      receipts: [{ slot: "post_turn_idle", consumedAt: at(7) }],
      fixed: { ...fixedConsumed, longIdleConsumed: false },
      assistantCompletedAt: completedAt,
    }),
    at(40),
  );
});

test("expired windows and spent concern slots never produce a wake", () => {
  assert.equal(
    concernWakeDueAt({
      pending: [{ considerAt: at(100), expiresAt: at(120) }],
      receipts: [{ slot: "concern_1", consumedAt: at(100) }],
      fixed: fixedConsumed,
      assistantCompletedAt: completedAt,
    }),
    null,
  );
  const spent = [
    { slot: "concern_1" as const, consumedAt: at(10) },
    { slot: "concern_2" as const, consumedAt: at(50) },
    { slot: "concern_3" as const, consumedAt: at(90) },
  ];
  assert.equal(nextConcernWakeSlot(spent), null);
  assert.equal(
    concernWakeDueAt({
      pending: [{ considerAt: at(200), expiresAt: at(2000) }],
      receipts: spent,
      fixed: fixedConsumed,
      assistantCompletedAt: completedAt,
    }),
    null,
  );
  assert.equal(nextConcernWakeSlot(spent.slice(0, 1)), "concern_2");
});

test("fixed wakes keep priority and a pending concern survives long idle", () => {
  const schedule: NativeLiveSilenceWakeSchedule = {
    epochId: "44444444-4444-4444-8444-444444444444",
    conversationId: "33333333-3333-4333-8333-333333333333",
    ...fixedConsumed,
    longIdleConsumed: false,
    postTurnConsumed: false,
    concernDueAt: at(5).toISOString(),
  };
  assert.equal(chooseDueWakeFireSlot(schedule, at(8).getTime()), "post_turn_idle");
  assert.equal(
    chooseDueWakeFireSlot({ ...schedule, postTurnConsumed: true }, at(8).getTime()),
    "concern",
  );
  const afterLong = { ...fixedConsumed, epochId: schedule.epochId, conversationId: schedule.conversationId,
    concernDueAt: at(300).toISOString() };
  assert.equal(nextSilenceWakeDeadline(afterLong, at(200).getTime()), at(300).getTime());
  assert.equal(nextSilenceWakeDeadline({ ...afterLong, concernDueAt: null }, at(200).getTime()), null);
});

test("concern receipt slots map to distinct reversible preparation ids", () => {
  const epochId = "44444444-4444-4444-8444-444444444444";
  const ids = (["post_turn_idle", "long_idle", "concern_1", "concern_2", "concern_3"] as const)
    .map((slot) => silenceWakePreparationId(epochId, slot));
  assert.equal(new Set(ids).size, ids.length);
  const concernId = silenceWakePreparationId(epochId, "concern_2");
  assert.ok(
    silenceWakeReceiptCandidatesForPreparationId(concernId)
      .some((candidate) => candidate.epochId === epochId && candidate.slot === "concern_2"),
  );
});

test("concern wake block hands Claude content, reason, progress and the fence", () => {
  const block = formatConcernWakeBlock([{
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    content: "惦记他今天面试的结果",
    reason: "他早上说下午两点面试",
    progress: "还没问过",
    considerAt: at(180),
    expiresAt: new Date("2026-10-20T15:59:00.000Z"),
    revision: 2,
    wakeCount: 0,
  }]);
  assert.match(block, /\[concern · id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa · expected_revision=2 · woken 1\/3 · keep until 10-20 23:59\]/u);
  assert.match(block, /惦记他今天面试的结果/u);
  assert.match(block, /reason: 他早上说下午两点面试/u);
  assert.match(block, /progress: 还没问过/u);
  assert.match(block, /update_concern/u);
  assert.match(block, /<quiet \/>/u);
});
