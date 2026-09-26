import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceCrossDeviceOpportunity,
} from "../src/domains/runtime/topic-resurface-cross-device-opportunity.js";

test("cross-device opportunity attempts immediately then enforces injected cadence", async () => {
  const calls: unknown[] = [];
  let now = "2026-09-23T04:00:00.000Z";
  const opportunity = new TopicResurfaceCrossDeviceOpportunity(
    {
      async start(input) {
        calls.push(input);
        return { outcome: "idle" as const };
      },
    },
    "G",
    { minIntervalMs: 60_000, candidateLimit: 5 },
    () => now,
  );

  assert.deepEqual(await opportunity.offer({ userId: " user-1 " }), {
    outcome: "attempted",
    attemptedAt: "2026-09-23T04:00:00.000Z",
    nextEligibleAt: "2026-09-23T04:01:00.000Z",
    result: { outcome: "idle" },
  });
  assert.deepEqual(calls, [{
    userId: "user-1",
    subjectId: "G",
    now: "2026-09-23T04:00:00.000Z",
    candidateLimit: 5,
  }]);

  now = "2026-09-23T04:00:30.000Z";
  assert.deepEqual(await opportunity.offer({ userId: "user-1" }), {
    outcome: "not_due",
    lastAttemptAt: "2026-09-23T04:00:00.000Z",
    nextEligibleAt: "2026-09-23T04:01:00.000Z",
  });
  assert.equal(calls.length, 1);
});

test("idle and waiting coordinator outcomes consume cadence but infrastructure failure does not", async () => {
  let now = "2026-09-23T04:00:00.000Z";
  let fail = true;
  let calls = 0;
  const opportunity = new TopicResurfaceCrossDeviceOpportunity(
    {
      async start() {
        calls += 1;
        if (fail) throw new Error("db unavailable");
        return { outcome: "waiting" as const, taskId: "task-1" };
      },
    },
    "G",
    { minIntervalMs: 60_000, candidateLimit: 3 },
    () => now,
  );

  await assert.rejects(
    () => opportunity.offer({ userId: "user-1" }),
    /db unavailable/,
  );

  fail = false;
  now = "2026-09-23T04:00:01.000Z";
  assert.equal(
    (await opportunity.offer({ userId: "user-1" })).outcome,
    "attempted",
  );
  now = "2026-09-23T04:00:02.000Z";
  assert.equal(
    (await opportunity.offer({ userId: "user-1" })).outcome,
    "not_due",
  );
  assert.equal(calls, 2);
});

test("cross-device opportunity requires explicit cadence and candidate policy", () => {
  assert.throws(
    () => new TopicResurfaceCrossDeviceOpportunity(
      { async start() { return { outcome: "idle" as const }; } },
      "G",
      { minIntervalMs: 0, candidateLimit: 5 },
    ),
    /minIntervalMs/,
  );
  assert.throws(
    () => new TopicResurfaceCrossDeviceOpportunity(
      { async start() { return { outcome: "idle" as const }; } },
      "G",
      { minIntervalMs: 1_000, candidateLimit: 0 },
    ),
    /candidateLimit/,
  );
});


test("cross-device opportunity coalesces concurrent offers for the same identity", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const opportunity = new TopicResurfaceCrossDeviceOpportunity(
    {
      async start() {
        calls += 1;
        await gate;
        return { outcome: "idle" as const };
      },
    },
    "G",
    { minIntervalMs: 60_000, candidateLimit: 5 },
    () => "2026-09-23T04:00:00.000Z",
  );

  const first = opportunity.offer({ userId: "user-1" });
  const second = opportunity.offer({ userId: "user-1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  release();
  assert.deepEqual(await second, await first);
  assert.equal(calls, 1);
});
