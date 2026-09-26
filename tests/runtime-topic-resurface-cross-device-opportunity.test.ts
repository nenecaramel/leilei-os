import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceCrossDeviceOpportunity,
} from "../src/domains/runtime/topic-resurface-cross-device-opportunity.js";

test("cross-device opportunity attempts whenever Companion offers a due cadence", async () => {
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
    { candidateLimit: 5 },
    () => now,
  );

  assert.deepEqual(await opportunity.offer({ userId: " user-1 " }), {
    outcome: "attempted",
    attemptedAt: "2026-09-23T04:00:00.000Z",
    result: { outcome: "idle" },
  });

  now = "2026-09-23T04:00:30.000Z";
  assert.equal(
    (await opportunity.offer({ userId: "user-1" })).outcome,
    "attempted",
  );
  assert.equal(calls.length, 2);
});

test("infrastructure failure does not install a second cadence gate", async () => {
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
    { candidateLimit: 3 },
  );

  await assert.rejects(
    () => opportunity.offer({ userId: "user-1" }),
    /db unavailable/,
  );

  fail = false;
  assert.equal(
    (await opportunity.offer({ userId: "user-1" })).outcome,
    "attempted",
  );
  assert.equal(calls, 2);
});

test("cross-device opportunity requires a positive candidate policy", () => {
  assert.throws(
    () => new TopicResurfaceCrossDeviceOpportunity(
      { async start() { return { outcome: "idle" as const }; } },
      "G",
      { candidateLimit: 0 },
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
    { candidateLimit: 5 },
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
