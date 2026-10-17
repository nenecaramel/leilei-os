import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  chooseDueSilenceWakeSlot,
  formatSilenceWakeMarker,
  silenceWakeDeadlines,
} from "../src/domains/bridge/turn/native-live-silence-wake.js";

test("silence wake jitter is stable and stays inside both configured windows", () => {
  const input = {
    epochId: "44444444-4444-4444-8444-444444444444",
    userActivityAt: "2026-10-04T01:00:00.000Z",
    assistantCompletedAt: "2026-10-04T01:01:00.000Z",
  };
  const first = silenceWakeDeadlines(input);
  const second = silenceWakeDeadlines(input);
  assert.deepEqual(first, second);

  const postDelay =
    Date.parse(first.postTurnDueAt) - Date.parse(input.assistantCompletedAt);
  const longDelay =
    Date.parse(first.longIdleDueAt) - Date.parse(input.userActivityAt);
  assert.ok(postDelay >= 5 * 60_000 && postDelay <= 10 * 60_000);
  assert.ok(longDelay >= 90 * 60_000 && longDelay <= 120 * 60_000);
});

test("wake marker carries only elapsed silence, without the hook-provided date and clock", () => {
  const marker = formatSilenceWakeMarker({
    now: new Date("2026-10-04T03:47:00.000Z"),
    userActivityAt: new Date("2026-10-04T02:00:00.000Z"),
  });
  assert.equal(marker, "[wake · +1h 47m · no reply]");
  assert.doesNotMatch(marker, /10-04|周日|11:47|2026/u);
  assert.equal(
    formatSilenceWakeMarker({
      now: new Date("2026-10-04T02:03:00.000Z"),
      userActivityAt: new Date("2026-10-04T02:00:00.000Z"),
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
