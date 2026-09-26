import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceCadenceGate,
} from "../src/domains/runtime/topic-resurface-cadence.js";

test("Topic resurface cadence schedules first opportunity immediately and blocks early repeats", () => {
  const scheduled: unknown[] = [];
  const gate = new TopicResurfaceCadenceGate(
    {
      schedule(input) {
        scheduled.push(input);
      },
    },
    { minIntervalMs: 60_000 },
  );

  assert.deepEqual(
    gate.offer({
      userId: " u1 ",
      subjectId: " G ",
      at: "2026-09-23T02:30:00+00:00",
    }),
    {
      outcome: "scheduled",
      scheduledAt: "2026-09-23T02:30:00.000Z",
      nextEligibleAt: "2026-09-23T02:31:00.000Z",
    },
  );
  assert.deepEqual(scheduled, [{
    userId: "u1",
    subjectId: "G",
  }]);

  assert.deepEqual(
    gate.offer({
      userId: "u1",
      subjectId: "G",
      at: "2026-09-23T02:30:59.999Z",
    }),
    {
      outcome: "not_due",
      lastScheduledAt: "2026-09-23T02:30:00.000Z",
      nextEligibleAt: "2026-09-23T02:31:00.000Z",
    },
  );
  assert.equal(scheduled.length, 1);
});

test("Topic resurface cadence allows an opportunity exactly when the injected interval is due", () => {
  const scheduled: unknown[] = [];
  const gate = new TopicResurfaceCadenceGate(
    {
      schedule(input) {
        scheduled.push(input);
      },
    },
    { minIntervalMs: 30_000 },
  );

  gate.offer({
    userId: "u1",
    subjectId: "G",
    at: "2026-09-23T02:30:00.000Z",
  });
  assert.deepEqual(
    gate.offer({
      userId: "u1",
      subjectId: "G",
      at: "2026-09-23T02:30:30.000Z",
    }),
    {
      outcome: "scheduled",
      scheduledAt: "2026-09-23T02:30:30.000Z",
      nextEligibleAt: "2026-09-23T02:31:00.000Z",
    },
  );
  assert.equal(scheduled.length, 2);
});

test("Topic resurface cadence tracks identities independently and clock rewind never accelerates work", () => {
  const scheduled: unknown[] = [];
  const gate = new TopicResurfaceCadenceGate(
    {
      schedule(input) {
        scheduled.push(input);
      },
    },
    { minIntervalMs: 60_000 },
  );

  gate.offer({
    userId: "u1",
    subjectId: "G",
    at: "2026-09-23T02:30:00.000Z",
  });
  gate.offer({
    userId: "u2",
    subjectId: "G",
    at: "2026-09-23T02:30:10.000Z",
  });

  assert.equal(
    gate.offer({
      userId: "u1",
      subjectId: "G",
      at: "2026-09-23T02:29:00.000Z",
    }).outcome,
    "not_due",
  );
  assert.deepEqual(scheduled, [
    { userId: "u1", subjectId: "G" },
    { userId: "u2", subjectId: "G" },
  ]);
});

test("Topic resurface cadence records time only after the schedule sink accepts the opportunity", () => {
  let fail = true;
  const scheduled: unknown[] = [];
  const gate = new TopicResurfaceCadenceGate(
    {
      schedule(input) {
        if (fail) throw new Error("sink rejected");
        scheduled.push(input);
      },
    },
    { minIntervalMs: 60_000 },
  );

  assert.throws(
    () => gate.offer({
      userId: "u1",
      subjectId: "G",
      at: "2026-09-23T02:30:00.000Z",
    }),
    /sink rejected/,
  );

  fail = false;
  assert.equal(
    gate.offer({
      userId: "u1",
      subjectId: "G",
      at: "2026-09-23T02:30:01.000Z",
    }).outcome,
    "scheduled",
  );
  assert.equal(scheduled.length, 1);
});

test("Topic resurface cadence requires explicit positive interval, valid identity and valid timestamp", () => {
  assert.throws(
    () => new TopicResurfaceCadenceGate(
      { schedule() {} },
      { minIntervalMs: 0 },
    ),
    /positive and finite/,
  );

  const gate = new TopicResurfaceCadenceGate(
    { schedule() {} },
    { minIntervalMs: 1_000 },
  );
  assert.throws(
    () => gate.offer({
      userId: " ",
      subjectId: "G",
      at: "2026-09-23T02:30:00.000Z",
    }),
    /identity/,
  );
  assert.throws(
    () => gate.offer({
      userId: "u1",
      subjectId: "G",
      at: "not-a-time",
    }),
    /ISO timestamp/,
  );
});
