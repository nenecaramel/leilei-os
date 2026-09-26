import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceIdleOpportunity,
} from "../src/domains/runtime/topic-resurface-idle-opportunity.js";

test("Topic resurface idle opportunity schedules and drains when cadence is due", async () => {
  const calls: string[] = [];
  const opportunity = new TopicResurfaceIdleOpportunity(
    {
      schedule(input) {
        calls.push(`schedule:${input.userId}:${input.subjectId}`);
      },
      async drain() {
        calls.push("drain");
      },
    },
    { userId: " u1 ", subjectId: " G " },
    { minIntervalMs: 60_000 },
    () => "2026-09-23T02:40:00+00:00",
  );

  assert.deepEqual(await opportunity.offer(), {
    outcome: "scheduled",
    scheduledAt: "2026-09-23T02:40:00.000Z",
    nextEligibleAt: "2026-09-23T02:41:00.000Z",
  });
  assert.deepEqual(calls, [
    "schedule:u1:G",
    "drain",
  ]);
});

test("Topic resurface idle opportunity does not drain when cadence is not due", async () => {
  const calls: string[] = [];
  let now = "2026-09-23T02:40:00.000Z";
  const opportunity = new TopicResurfaceIdleOpportunity(
    {
      schedule() {
        calls.push("schedule");
      },
      async drain() {
        calls.push("drain");
      },
    },
    { userId: "u1", subjectId: "G" },
    { minIntervalMs: 60_000 },
    () => now,
  );

  await opportunity.offer();
  now = "2026-09-23T02:40:30.000Z";
  assert.equal((await opportunity.offer()).outcome, "not_due");
  assert.deepEqual(calls, ["schedule", "drain"]);
});

test("Topic resurface idle opportunity awaits background drain before completing", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished = false;
  const opportunity = new TopicResurfaceIdleOpportunity(
    {
      schedule() {},
      async drain() {
        await gate;
        finished = true;
      },
    },
    { userId: "u1", subjectId: "G" },
    { minIntervalMs: 60_000 },
    () => "2026-09-23T02:40:00.000Z",
  );

  const pending = opportunity.offer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);

  release();
  await pending;
  assert.equal(finished, true);
});

test("Topic resurface idle opportunity requires explicit identity", () => {
  assert.throws(
    () => new TopicResurfaceIdleOpportunity(
      {
        schedule() {},
        async drain() {},
      },
      { userId: "", subjectId: "G" },
      { minIntervalMs: 60_000 },
    ),
    /identity/,
  );
});
