import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  chooseDueSilenceWakeSlot,
  formatSilenceWakeMarker,
  nextSilenceWakeDeadline,
  nextRecurringIdleSlot,
  recurringIdleAnchor,
  recurringIdleDueAt,
  RECURRING_IDLE_LIMIT,
  silenceWakeDeadlines,
  silenceWakePreparationId,
  silenceWakeReceiptCandidatesForPreparationId,
} from "../src/domains/bridge/turn/native-live-silence-wake.js";
import { parseSilenceWakeSchedule } from "../src/domains/bridge/mac/native-live-mac-relay-response.js";

test("silence wake jitter is stable and the post-reply window starts when the reply completes", () => {
  // A 30-minute turn: silence starts at the reply, not at the user's message.
  const assistantCompletedAt = "2026-10-04T01:30:00.000Z";
  const input = {
    epochId: "44444444-4444-4444-8444-444444444444",
    assistantCompletedAt,
  };
  const first = silenceWakeDeadlines(input);
  const second = silenceWakeDeadlines(input);
  assert.deepEqual(first, second);

  const postDelay =
    Date.parse(first.postTurnDueAt) - Date.parse(assistantCompletedAt);
  assert.ok(postDelay >= 2 * 60_000 && postDelay <= 5 * 60_000);
});

test("the post-reply wake lands 2–5 minutes after the reply for every epoch", () => {
  const delays = Array.from({ length: 64 }, (_, index) => {
    const epochId = `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
    const { postTurnDueAt } = silenceWakeDeadlines({ epochId,
      assistantCompletedAt: "2026-10-04T01:01:00.000Z" });
    return Date.parse(postTurnDueAt) - Date.parse("2026-10-04T01:01:00.000Z");
  });
  for (const delay of delays) assert.ok(delay >= 2 * 60_000 && delay <= 5 * 60_000, String(delay));
  assert.ok(Math.min(...delays) < 3 * 60_000 && Math.max(...delays) > 4 * 60_000, "the jitter spans the window");
});

test("wake marker carries only silence since the reply, without the hook-provided date and clock", () => {
  const marker = formatSilenceWakeMarker({
    now: new Date("2026-10-04T03:47:00.000Z"),
    assistantCompletedAt: new Date("2026-10-04T02:00:00.000Z"),
  });
  assert.equal(marker, "[wake · +1h 47m · no reply]");
  assert.doesNotMatch(marker, /10-04|周日|11:47|2026/u);
  assert.equal(
    formatSilenceWakeMarker({
      now: new Date("2026-10-04T02:03:00.000Z"),
      assistantCompletedAt: new Date("2026-10-04T02:00:00.000Z"),
    }),
    "[wake · +3m · no reply]",
  );
});

test("long idle wins catch-up when both silence slots are already due", () => {
  const schedule = {
    epochId: "44444444-4444-4444-8444-444444444444",
    conversationId: "33333333-3333-4333-8333-333333333333",
    postTurnDueAt: "2026-10-04T01:08:00.000Z",
    longIdleDueAt: "2026-10-04T02:40:00.000Z",
    postTurnConsumed: false,
    longIdleConsumed: false,
  };
  assert.equal(
    chooseDueSilenceWakeSlot(schedule, Date.parse("2026-10-04T02:41:00.000Z")),
    "long_idle",
  );
});

test("post-turn consumption never consumes the independent long-idle slot", () => {
  const schedule = {
    epochId: "44444444-4444-4444-8444-444444444444",
    conversationId: "33333333-3333-4333-8333-333333333333",
    postTurnDueAt: "2026-10-04T01:08:00.000Z",
    longIdleDueAt: "2026-10-04T02:40:00.000Z",
    postTurnConsumed: true,
    longIdleConsumed: false,
  };
  assert.equal(
    chooseDueSilenceWakeSlot(schedule, Date.parse("2026-10-04T02:41:00.000Z")),
    "long_idle",
  );
});


test("wake finalization revalidates exact latest user identity without timestamp round-trip", () => {
  const source = fs.readFileSync(
    "src/domains/bridge/turn/turn-repository/finalize-success.ts",
    "utf8",
  );

  assert.match(
    source,
    /\.orderBy\(\s*desc\(conversationMessages\.createdAt\),\s*desc\(conversationMessages\.id\),\s*\)/u,
  );
  assert.match(
    source,
    /latestUser\?\.id !== wake\.sourceUserMessageId/u,
  );
  assert.doesNotMatch(
    source,
    /gt\(\s*conversationMessages\.createdAt/u,
  );
});

test("the Mac parses the mid slot and still accepts an older server's schedule", () => {
  const midSchedule = {
    epochId: "44444444-4444-4444-8444-444444444444",
    conversationId: "33333333-3333-4333-8333-333333333333",
    postTurnDueAt: "2026-10-04T01:04:00.000Z",
    midIdleDueAt: "2026-10-04T01:35:00.000Z",
    longIdleDueAt: "2026-10-04T02:40:00.000Z",
    postTurnConsumed: false,
    midIdleConsumed: false,
    longIdleConsumed: false,
  };
  const parsed = parseSilenceWakeSchedule(midSchedule);
  assert.equal(parsed.midIdleDueAt, midSchedule.midIdleDueAt);
  assert.equal(parsed.midIdleConsumed, false);
  const { midIdleDueAt: _due, midIdleConsumed: _consumed, ...older } = midSchedule;
  const legacy = parseSilenceWakeSchedule(older);
  assert.equal(legacy.midIdleDueAt, null);
  assert.equal(legacy.midIdleConsumed, false);
  assert.throws(() => parseSilenceWakeSchedule({ ...midSchedule, midIdleDueAt: "not a date" }));
  assert.throws(() => parseSilenceWakeSchedule({ ...midSchedule, midIdleConsumed: "no" }));
});

// Owner's choice (10/29): after the 2–5 minute wake, wake every 30–40 minutes
// from the later of Claude's last message and the last wake, so the prompt
// cache never goes cold, until she replies. The wire keeps the long slot.
test("each recurring wake lands 30–40 minutes after the last activity with stable per-wake jitter", () => {
  const epochId = "44444444-4444-4444-8444-444444444444";
  const lastActivityAt = new Date("2026-10-04T01:01:00.000Z");
  const delays = Array.from({ length: 64 }, (_, index) => {
    const due = recurringIdleDueAt({ epochId, sequence: index + 1, lastActivityAt });
    assert.deepEqual(due, recurringIdleDueAt({ epochId, sequence: index + 1, lastActivityAt }));
    return due.getTime() - lastActivityAt.getTime();
  });
  for (const delay of delays) assert.ok(delay >= 30 * 60_000 && delay <= 40 * 60_000, String(delay));
  assert.ok(Math.min(...delays) < 33 * 60_000 && Math.max(...delays) > 37 * 60_000, "the jitter spans the window");
});

test("recurring wakes are numbered per silence epoch and stop at the safety limit", () => {
  const at = new Date("2026-10-04T01:00:00.000Z");
  assert.equal(RECURRING_IDLE_LIMIT, 64);
  assert.equal(nextRecurringIdleSlot([]), "idle_1");
  assert.equal(nextRecurringIdleSlot([{ slot: "post_turn_idle", consumedAt: at }, { slot: "concern_1", consumedAt: at }]), "idle_1");
  assert.equal(nextRecurringIdleSlot([{ slot: "idle_1", consumedAt: at }, { slot: "idle_2", consumedAt: at }]), "idle_3");
  const spent = Array.from({ length: 64 }, (_, index) => ({ slot: `idle_${index + 1}` as const, consumedAt: at }));
  assert.equal(nextRecurringIdleSlot(spent), null);
});

test("every recurring wake has its own preparation id and receipt", () => {
  const epochId = "44444444-4444-4444-8444-444444444444";
  const slots = ["post_turn_idle", "mid_idle", "long_idle", "concern_1", "concern_2", "concern_3",
    ...Array.from({ length: 64 }, (_, index) => `idle_${index + 1}` as const)] as const;
  assert.equal(new Set(slots.map(slot => silenceWakePreparationId(epochId, slot))).size, slots.length);
  const idle = silenceWakePreparationId(epochId, "idle_17");
  assert.deepEqual(silenceWakeReceiptCandidatesForPreparationId(idle).find(row => row.epochId === epochId), { epochId, slot: "idle_17" });
  const schema = fs.readFileSync("src/database/schema/native-live-silence-wake.ts", "utf8");
  assert.match(schema, /idle_/u);
  const migration = fs.readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort().at(-1)!;
  assert.match(fs.readFileSync(`drizzle/${migration}`, "utf8"), /idle_\(\[1-9\]\|\[1-5\]\[0-9\]\|6\[0-4\]\)/u);
});

test("the Mac fires the recurring wake through the long slot it already knows", () => {
  const schedule = {
    epochId: "44444444-4444-4444-8444-444444444444",
    conversationId: "33333333-3333-4333-8333-333333333333",
    postTurnDueAt: "2026-10-04T01:04:00.000Z",
    longIdleDueAt: "2026-10-04T01:35:00.000Z",
    postTurnConsumed: true,
    longIdleConsumed: false,
    midIdleDueAt: null,
    midIdleConsumed: false,
  };
  assert.equal(chooseDueSilenceWakeSlot(schedule, Date.parse("2026-10-04T01:34:00.000Z")), null);
  assert.equal(chooseDueSilenceWakeSlot(schedule, Date.parse("2026-10-04T01:35:00.000Z")), "long_idle");
  assert.equal(nextSilenceWakeDeadline(schedule, Date.parse("2026-10-04T01:10:00.000Z")), Date.parse(schedule.longIdleDueAt));
});

test("the recurring wake counts from the later of Claude's last message and the last wake", () => {
  const at = (minute: number) => new Date(Date.parse("2026-10-04T01:00:00.000Z") + minute * 60_000);
  // A quiet wake leaves no message, so the wake itself is the latest activity.
  assert.deepEqual(recurringIdleAnchor({ lastAssistantCompletedAt: at(0),
    receipts: [{ slot: "post_turn_idle", consumedAt: at(3) }, { slot: "idle_1", consumedAt: at(38) }] }), at(38));
  // A visible wake's message completes after its receipt and becomes the anchor.
  assert.deepEqual(recurringIdleAnchor({ lastAssistantCompletedAt: at(39),
    receipts: [{ slot: "idle_1", consumedAt: at(38) }] }), at(39));
  assert.deepEqual(recurringIdleAnchor({ lastAssistantCompletedAt: at(0), receipts: [] }), at(0));
});
