
import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundLoopOrchestrator,
  CLAUDE_CODE_BACKGROUND_MUTEX,
  subjectStateBackgroundMutexKey,
  type BackgroundLoopObserverEvent,
} from "../src/domains/runtime/background/background-loop-orchestrator.js";

test("Background Loop Orchestrator honors priority and coalesces pending keys", async () => {
  const order: string[] = [];
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 4,
    maxCostPerCycle: 4,
    maxConcurrent: 1,
  });

  orchestrator.schedule({
    key: "reflection",
    kind: "topic_resurface",
    priority: "reflection",
    cost: 1,
    mutexKeys: [],
    async run() {
      order.push("reflection-old");
    },
  });
  orchestrator.schedule({
    key: "maintenance",
    kind: "decay",
    priority: "maintenance",
    cost: 1,
    mutexKeys: [],
    async run() {
      order.push("maintenance");
    },
  });
  orchestrator.schedule({
    key: "reflection",
    kind: "topic_resurface",
    priority: "reflection",
    cost: 1,
    mutexKeys: [],
    async run() {
      order.push("reflection-latest");
    },
  });
  orchestrator.schedule({
    key: "consolidation",
    kind: "distillation",
    priority: "consolidation",
    cost: 1,
    mutexKeys: [CLAUDE_CODE_BACKGROUND_MUTEX],
    async run() {
      order.push("consolidation");
    },
  });

  const summary = await orchestrator.drain();
  assert.deepEqual(order, [
    "consolidation",
    "maintenance",
    "reflection-latest",
  ]);
  assert.deepEqual(summary, {
    runsStarted: 3,
    completed: 3,
    failed: 0,
    costStarted: 3,
    pending: 0,
    budgetExhausted: false,
  });
});

test("Background Loop Orchestrator stops at one explicit cycle budget and requires another kick", async () => {
  const order: string[] = [];
  const events: BackgroundLoopObserverEvent[] = [];
  const orchestrator = new BackgroundLoopOrchestrator(
    {
      maxRunsPerCycle: 4,
      maxCostPerCycle: 2,
      maxConcurrent: 1,
    },
    (event) => events.push(event),
  );

  for (const key of ["a", "b"]) {
    orchestrator.schedule({
      key,
      kind: "decay",
      priority: "maintenance",
      cost: 2,
      mutexKeys: [],
      async run() {
        order.push(key);
      },
    });
  }

  const first = await orchestrator.drain();
  assert.deepEqual(order, ["a"]);
  assert.equal(first?.pending, 1);
  assert.equal(first?.budgetExhausted, true);
  assert.equal(orchestrator.pendingCount(), 1);
  assert.equal(
    events.some(
      (event) =>
        event.name === "background_loop_cycle_budget_exhausted",
    ),
    true,
  );

  orchestrator.kick();
  const second = await orchestrator.drain();
  assert.deepEqual(order, ["a", "b"]);
  assert.equal(second?.pending, 0);
  assert.equal(second?.budgetExhausted, false);
});

test("Background Loop Orchestrator allows disjoint resources concurrently but serializes the same Subject", async () => {
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 3,
    maxCostPerCycle: 3,
    maxConcurrent: 2,
  });
  const sameSubject = subjectStateBackgroundMutexKey({
    userId: "u1",
    subjectId: "G",
  });
  const otherSubject = subjectStateBackgroundMutexKey({
    userId: "u2",
    subjectId: "G",
  });

  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const started: string[] = [];

  orchestrator.schedule({
    key: "u1-first",
    kind: "thought_evolution",
    priority: "maintenance",
    cost: 1,
    mutexKeys: [sameSubject],
    async run() {
      started.push("u1-first");
      await gate;
    },
  });
  orchestrator.schedule({
    key: "u1-second",
    kind: "drive_evolution",
    priority: "maintenance",
    cost: 1,
    mutexKeys: [sameSubject],
    async run() {
      started.push("u1-second");
    },
  });
  orchestrator.schedule({
    key: "u2",
    kind: "topic_lifecycle",
    priority: "maintenance",
    cost: 1,
    mutexKeys: [otherSubject],
    async run() {
      started.push("u2");
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ["u1-first", "u2"]);
  releaseFirst();

  const summary = await orchestrator.drain();
  assert.equal(summary?.completed, 3);
  assert.equal(started.includes("u1-second"), true);
});

test("Background Loop Orchestrator isolates failures and continues the cycle", async () => {
  const events: BackgroundLoopObserverEvent[] = [];
  const calls: string[] = [];
  const orchestrator = new BackgroundLoopOrchestrator(
    {
      maxRunsPerCycle: 3,
      maxCostPerCycle: 3,
      maxConcurrent: 1,
    },
    (event) => events.push(event),
  );

  orchestrator.schedule({
    key: "bad",
    kind: "distillation",
    priority: "consolidation",
    cost: 1,
    mutexKeys: [],
    async run() {
      calls.push("bad");
      throw new TypeError("boom");
    },
  });
  orchestrator.schedule({
    key: "good",
    kind: "decay",
    priority: "maintenance",
    cost: 1,
    mutexKeys: [],
    async run() {
      calls.push("good");
    },
  });

  const summary = await orchestrator.drain();
  assert.deepEqual(calls, ["bad", "good"]);
  assert.equal(summary?.failed, 1);
  assert.equal(summary?.completed, 1);
  assert.deepEqual(
    events.find(
      (event) => event.name === "background_loop_job_failed",
    ),
    {
      name: "background_loop_job_failed",
      key: "bad",
      kind: "distillation",
      errorName: "TypeError",
    },
  );
});

test("Background Loop Orchestrator validates operational budgets and jobs", () => {
  assert.throws(
    () => new BackgroundLoopOrchestrator({
      maxRunsPerCycle: 0,
      maxCostPerCycle: 1,
      maxConcurrent: 1,
    }),
    /maxRunsPerCycle/,
  );

  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 1,
    maxCostPerCycle: 1,
    maxConcurrent: 1,
  });
  assert.throws(
    () => orchestrator.schedule({
      key: "",
      kind: "decay",
      priority: "consolidation",
      cost: 1,
      mutexKeys: [],
      async run() {},
    }),
    /key/,
  );
  assert.throws(
    () => orchestrator.schedule({
      key: "bad-cost",
      kind: "decay",
      priority: "consolidation",
      cost: 0,
      mutexKeys: [],
      async run() {},
    }),
    /cost/,
  );
});
