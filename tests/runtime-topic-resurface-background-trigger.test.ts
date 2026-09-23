import assert from "node:assert/strict";
import test from "node:test";
import {
  TopicResurfaceBackgroundTrigger,
  type TopicResurfaceBackgroundObserverEvent,
} from "../src/domains/runtime/topic-resurface-background-trigger.js";

test("Topic resurface background trigger is non-blocking, globally serial and coalesces pending identity", async () => {
  const calls: Array<{
    userId: string;
    subjectId: string;
    now: string;
    candidateLimit: number;
  }> = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const trigger = new TopicResurfaceBackgroundTrigger(
    {
      async runOnce(input) {
        calls.push(input);
        if (calls.length === 1) await firstGate;
        return {
          outcome: "quiet" as const,
          evaluatedAt: input.now,
          candidateCount: 1,
        };
      },
    },
    7,
    () => "2026-09-23T02:15:00+00:00",
  );

  trigger.schedule({ userId: "u1", subjectId: "G" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);

  trigger.schedule({ userId: "u1", subjectId: "G" });
  trigger.schedule({ userId: "u1", subjectId: "G" });
  trigger.schedule({ userId: "u2", subjectId: "G" });

  releaseFirst();
  await trigger.drain();

  assert.deepEqual(calls, [
    {
      userId: "u1",
      subjectId: "G",
      now: "2026-09-23T02:15:00.000Z",
      candidateLimit: 7,
    },
    {
      userId: "u1",
      subjectId: "G",
      now: "2026-09-23T02:15:00.000Z",
      candidateLimit: 7,
    },
    {
      userId: "u2",
      subjectId: "G",
      now: "2026-09-23T02:15:00.000Z",
      candidateLimit: 7,
    },
  ]);
});

test("Topic resurface background runner failure is observed and never escapes drain", async () => {
  const observed: TopicResurfaceBackgroundObserverEvent[] = [];
  const trigger = new TopicResurfaceBackgroundTrigger(
    {
      async runOnce() {
        throw new TypeError("background failed");
      },
    },
    3,
    () => "2026-09-23T02:16:00.000Z",
    (event) => observed.push(event),
  );

  trigger.schedule({ userId: "u1", subjectId: "G" });
  await trigger.drain();

  assert.deepEqual(observed, [{
    name: "topic_resurface_background_error",
    userId: "u1",
    subjectId: "G",
    errorName: "TypeError",
  }]);
});

test("Topic resurface background publishes internal run result without changing its meaning", async () => {
  const observed: TopicResurfaceBackgroundObserverEvent[] = [];
  const trigger = new TopicResurfaceBackgroundTrigger(
    {
      async runOnce(input) {
        return {
          outcome: "materialized" as const,
          stateId: "11111111-1111-8111-8111-111111111111",
        };
      },
    },
    2,
    () => "2026-09-23T02:17:00.000Z",
    (event) => observed.push(event),
  );

  trigger.schedule({ userId: "u1", subjectId: "G" });
  await trigger.drain();

  assert.deepEqual(observed, [{
    name: "topic_resurface_background_run",
    userId: "u1",
    subjectId: "G",
    result: {
      outcome: "materialized",
      stateId: "11111111-1111-8111-8111-111111111111",
    },
  }]);
});

test("Topic resurface background requires explicit positive candidate bound and valid identity", async () => {
  assert.throws(
    () => new TopicResurfaceBackgroundTrigger(
      { async runOnce() { return { outcome: "source_ineligible" as const }; } },
      0,
    ),
    /positive integer/,
  );

  const trigger = new TopicResurfaceBackgroundTrigger(
    { async runOnce() { return { outcome: "source_ineligible" as const }; } },
    1,
  );
  assert.throws(
    () => trigger.schedule({ userId: " ", subjectId: "G" }),
    /identity/,
  );
});
