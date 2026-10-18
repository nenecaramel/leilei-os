import assert from "node:assert/strict";
import test from "node:test";
import {
  NativeLiveMacSilenceWakeScheduler,
  type NativeLiveMacSilenceWakeClient,
} from "../src/domains/bridge/mac/native-live-mac-silence-wake-scheduler.js";

const epochId = "44444444-4444-4444-8444-444444444444";
const conversationId = "33333333-3333-4333-8333-333333333333";

class FakeClient implements NativeLiveMacSilenceWakeClient {
  schedule = {
    epochId,
    conversationId,
    postTurnDueAt: "2026-10-04T01:08:00.000Z",
    longIdleDueAt: "2026-10-04T02:40:00.000Z",
    postTurnConsumed: false,
    longIdleConsumed: false,
  };
  fired: unknown[] = [];

  async readSilenceWakeSchedule() {
    return this.schedule;
  }

  async fireSilenceWake(input: { epochId: string; slot: "post_turn_idle" | "long_idle" }) {
    this.fired.push(input);
    if (input.slot === "post_turn_idle") this.schedule.postTurnConsumed = true;
    else this.schedule.longIdleConsumed = true;
    return { outcome: "queued" as const, schedule: this.schedule };
  }
}

test("Mac silence scheduler wakes once at the short deadline and preserves long idle", async () => {
  let now = Date.parse("2026-10-04T01:07:00.000Z");
  const client = new FakeClient();
  const scheduler = new NativeLiveMacSilenceWakeScheduler(client, () => now);
  await scheduler.refresh();

  assert.equal(scheduler.nextDeadlineAt(), Date.parse("2026-10-04T01:08:00.000Z"));
  now = Date.parse("2026-10-04T01:08:00.000Z");
  assert.deepEqual(await scheduler.fireDue(), {
    outcome: "queued",
    slot: "post_turn_idle",
  });
  assert.deepEqual(client.fired, [{ epochId, slot: "post_turn_idle" }]);
  assert.equal(scheduler.nextDeadlineAt(), Date.parse("2026-10-04T02:40:00.000Z"));
});

test("Mac sleep catch-up drops the short slot when long idle is also due", async () => {
  const client = new FakeClient();
  const scheduler = new NativeLiveMacSilenceWakeScheduler(
    client,
    () => Date.parse("2026-10-04T02:41:00.000Z"),
  );
  await scheduler.refresh();

  assert.deepEqual(await scheduler.fireDue(), {
    outcome: "queued",
    slot: "long_idle",
  });
  assert.deepEqual(client.fired, [{ epochId, slot: "long_idle" }]);
});

test("new epoch from the backend replaces all old local deadlines", async () => {
  const client = new FakeClient();
  const scheduler = new NativeLiveMacSilenceWakeScheduler(
    client,
    () => Date.parse("2026-10-04T01:00:00.000Z"),
  );
  await scheduler.refresh();

  client.schedule = {
    epochId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    conversationId,
    postTurnDueAt: "2026-10-04T04:08:00.000Z",
    longIdleDueAt: "2026-10-04T05:40:00.000Z",
    postTurnConsumed: false,
    longIdleConsumed: false,
  };
  await scheduler.refresh();
  assert.equal(scheduler.nextDeadlineAt(), Date.parse("2026-10-04T04:08:00.000Z"));
});


test("Mac silence scheduler propagates backend ignored reason", async () => {
  const schedule = {
    epochId,
    conversationId,
    postTurnDueAt: "2026-10-04T01:08:00.000Z",
    longIdleDueAt: "2026-10-04T02:40:00.000Z",
    postTurnConsumed: false,
    longIdleConsumed: false,
  };
  const client: NativeLiveMacSilenceWakeClient = {
    async readSilenceWakeSchedule() {
      return schedule;
    },
    async fireSilenceWake() {
      return {
        outcome: "ignored",
        reason: "foreground_active",
        schedule: null,
      };
    },
  };
  const scheduler = new NativeLiveMacSilenceWakeScheduler(
    client,
    () => Date.parse("2026-10-04T01:08:00.000Z"),
  );
  await scheduler.refresh();

  assert.deepEqual(await scheduler.fireDue(), {
    outcome: "ignored",
    slot: "post_turn_idle",
    reason: "foreground_active",
  });
  assert.equal(scheduler.nextDeadlineAt(), null);
});

test("local switch blocks due wake and resumes without replacing the epoch", async () => {
  let enabled=true;
  const client=new FakeClient();
  const scheduler=new NativeLiveMacSilenceWakeScheduler(client,()=>Date.parse("2026-10-04T01:08:00Z"),{isEnabled:()=>enabled,watch:()=>()=>{}});
  await scheduler.refresh();
  enabled=false;
  assert.equal(scheduler.nextDeadlineAt(),null);
  assert.deepEqual(await scheduler.fireDue(),{outcome:"not_due"});
  assert.equal(client.fired.length,0);
  enabled=true;
  assert.deepEqual(await scheduler.fireDue(),{outcome:"queued",slot:"post_turn_idle"});
  assert.deepEqual(client.fired,[{epochId,slot:"post_turn_idle"}]);
});
