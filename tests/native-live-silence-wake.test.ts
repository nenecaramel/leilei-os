import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  chooseDueSilenceWakeSlot,
  formatSilenceWakeMarker,
  nextSilenceWakeDeadline,
  silenceWakeDeadlines,
  silenceWakePreparationId,
  silenceWakeReceiptCandidatesForPreparationId,
} from "../src/domains/bridge/turn/native-live-silence-wake.js";
import { parseSilenceWakeSchedule } from "../src/domains/bridge/mac/native-live-mac-relay-response.js";

test("silence wake jitter is stable and both windows start when the reply completes", () => {
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
  const longDelay =
    Date.parse(first.longIdleDueAt) - Date.parse(assistantCompletedAt);
  assert.ok(postDelay >= 2 * 60_000 && postDelay <= 5 * 60_000);
  assert.ok(longDelay >= 90 * 60_000 && longDelay <= 120 * 60_000);
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

// Owner's choice (10/28): a third silence wake 30–40 minutes after the reply.
test("the mid-silence wake lands 30–40 minutes after the reply for every epoch", () => {
  const base = "2026-10-04T01:01:00.000Z";
  const delays = Array.from({ length: 64 }, (_, index) => {
    const epochId = `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`;
    const { midIdleDueAt } = silenceWakeDeadlines({ epochId, assistantCompletedAt: base });
    return Date.parse(midIdleDueAt) - Date.parse(base);
  });
  for (const delay of delays) assert.ok(delay >= 30 * 60_000 && delay <= 40 * 60_000, String(delay));
  assert.ok(Math.min(...delays) < 33 * 60_000 && Math.max(...delays) > 37 * 60_000, "the jitter spans the window");
});

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

test("the three silence slots fire in order and a later due slot makes earlier ones stale", () => {
  const at = (iso: string) => Date.parse(iso);
  assert.equal(chooseDueSilenceWakeSlot(midSchedule, at("2026-10-04T01:03:00.000Z")), null);
  assert.equal(chooseDueSilenceWakeSlot(midSchedule, at("2026-10-04T01:05:00.000Z")), "post_turn_idle");
  assert.equal(chooseDueSilenceWakeSlot({ ...midSchedule, postTurnConsumed: true }, at("2026-10-04T01:20:00.000Z")), null);
  // A Mac that slept through the post slot catches up only the mid slot.
  assert.equal(chooseDueSilenceWakeSlot(midSchedule, at("2026-10-04T01:36:00.000Z")), "mid_idle");
  assert.equal(chooseDueSilenceWakeSlot({ ...midSchedule, midIdleConsumed: true }, at("2026-10-04T01:36:00.000Z")), null);
  assert.equal(chooseDueSilenceWakeSlot({ ...midSchedule, midIdleConsumed: true }, at("2026-10-04T02:41:00.000Z")), "long_idle");
  assert.equal(chooseDueSilenceWakeSlot(midSchedule, at("2026-10-04T02:41:00.000Z")), "long_idle");
});

test("the next deadline includes the mid slot and an older server's schedule keeps two slots", () => {
  const at = (iso: string) => Date.parse(iso);
  assert.equal(nextSilenceWakeDeadline({ ...midSchedule, postTurnConsumed: true }, at("2026-10-04T01:10:00.000Z")), at(midSchedule.midIdleDueAt));
  assert.equal(nextSilenceWakeDeadline({ ...midSchedule, postTurnConsumed: true, midIdleConsumed: true }, at("2026-10-04T01:40:00.000Z")), at(midSchedule.longIdleDueAt));
  const { midIdleDueAt: _due, midIdleConsumed: _consumed, ...older } = midSchedule;
  assert.equal(chooseDueSilenceWakeSlot({ ...older, postTurnConsumed: true }, at("2026-10-04T01:36:00.000Z")), null);
  assert.equal(nextSilenceWakeDeadline({ ...older, postTurnConsumed: true }, at("2026-10-04T01:10:00.000Z")), at(midSchedule.longIdleDueAt));
});

test("the mid slot has its own wake preparation id and receipt", () => {
  const epochId = "44444444-4444-4444-8444-444444444444";
  const mid = silenceWakePreparationId(epochId, "mid_idle");
  assert.equal(new Set((["post_turn_idle", "mid_idle", "long_idle", "concern_1", "concern_2", "concern_3"] as const)
    .map(slot => silenceWakePreparationId(epochId, slot))).size, 6);
  assert.deepEqual(silenceWakeReceiptCandidatesForPreparationId(mid).find(row => row.epochId === epochId), { epochId, slot: "mid_idle" });
  const schema = fs.readFileSync("src/database/schema/native-live-silence-wake.ts", "utf8");
  assert.match(schema, /'mid_idle'/u);
  const migration = fs.readdirSync("drizzle").filter(name => name.endsWith(".sql")).sort().at(-1)!;
  assert.match(fs.readFileSync(`drizzle/${migration}`, "utf8"), /CHECK \("slot" IN \('post_turn_idle', 'mid_idle', 'long_idle', 'concern_1', 'concern_2', 'concern_3'\)\)/u);
});

test("the Mac parses the mid slot and still accepts an older server's schedule", () => {
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
