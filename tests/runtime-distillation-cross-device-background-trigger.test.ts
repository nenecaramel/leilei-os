import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundLoopOrchestrator,
  CLAUDE_CODE_BACKGROUND_MUTEX,
} from "../src/domains/runtime/background-loop-orchestrator.js";
import {
  DistillationCrossDeviceBackgroundTrigger,
} from "../src/domains/runtime/distillation-cross-device-background-trigger.js";

test("cross-device Distillation stages through the shared orchestrator without claiming the local Claude mutex", async () => {
  const loops = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 4,
    maxCostPerCycle: 4,
    maxConcurrent: 2,
  });
  let releaseModel!: () => void;
  const modelGate = new Promise<void>((resolve) => {
    releaseModel = resolve;
  });
  let started = false;

  loops.schedule({
    key: "local-model",
    kind: "topic_resurface",
    priority: "reflection",
    cost: 1,
    mutexKeys: [CLAUDE_CODE_BACKGROUND_MUTEX],
    async run() {
      await modelGate;
    },
  });

  const trigger = new DistillationCrossDeviceBackgroundTrigger(
    loops,
    {
      async start(input) {
        started = true;
        return {
          outcome: "staged" as const,
          taskId: "11111111-1111-4111-8111-111111111111",
          runId: "22222222-2222-4222-8222-222222222222",
        };
      },
    },
    "G",
    {
      priority: "consolidation",
      cost: 1,
    },
  );

  trigger.schedule({
    userId: "u1",
    conversationId: "c1",
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started, true);

  releaseModel();
  const summary = await loops.drain();
  assert.equal(summary?.completed, 2);
});

test("cross-device Distillation staging failure is fail-soft at the shared execution boundary", async () => {
  const loops = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 2,
    maxCostPerCycle: 2,
    maxConcurrent: 1,
  });
  const observed: unknown[] = [];
  const trigger = new DistillationCrossDeviceBackgroundTrigger(
    loops,
    {
      async start() {
        throw new TypeError("queue unavailable");
      },
    },
    "G",
    {
      priority: "consolidation",
      cost: 1,
    },
    (event) => observed.push(event),
  );

  trigger.schedule({
    userId: "u1",
    conversationId: "c1",
  });
  const summary = await loops.drain();

  assert.equal(summary?.failed, 1);
  assert.deepEqual(observed, [{
    name: "distillation_cross_device_background_error",
    userId: "u1",
    conversationId: "c1",
    errorName: "TypeError",
  }]);
});
