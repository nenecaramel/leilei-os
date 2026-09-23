import assert from "node:assert/strict";
import test from "node:test";
import type { NativeLiveConversation } from "../src/domains/conversation/native-live-conversation-types.js";
import {
  BackgroundLoopOrchestrator,
} from "../src/domains/runtime/background-loop-orchestrator.js";
import {
  DistillationBackgroundTrigger,
  type DistillationBackgroundObserverEvent,
} from "../src/domains/runtime/distillation-background-trigger.js";

const now = "2026-09-22T09:50:00.000Z";

function conversation(id = "c1"): NativeLiveConversation {
  return {
    id,
    userId: "u1",
    title: null,
    lifecycleStatus: "active",
    currentHeadMessageId: null,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function createOrchestrator() {
  return new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 8,
    maxCostPerCycle: 8,
    maxConcurrent: 4,
  });
}

test("Distillation uses the shared orchestrator, stays globally model-serialized, and coalesces repeated pending conversation opportunities", async () => {
  const reads: string[] = [];
  const runs: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const orchestrator = createOrchestrator();

  const trigger = new DistillationBackgroundTrigger(
    orchestrator,
    {
      async getConversation(input) {
        reads.push(input.conversationId);
        return conversation(input.conversationId);
      },
    },
    {
      async runOnce(input) {
        runs.push(input.conversation.id);
        if (runs.length === 1) await firstGate;
        return { outcome: "idle" as const };
      },
    },
    "G",
    {
      priority: "consolidation",
      cost: 1,
    },
  );

  trigger.schedule({ userId: "u1", conversationId: "c1" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runs, ["c1"]);

  trigger.schedule({ userId: "u1", conversationId: "c1" });
  trigger.schedule({ userId: "u1", conversationId: "c1" });
  trigger.schedule({ userId: "u1", conversationId: "c2" });

  releaseFirst();
  await trigger.drain();

  assert.deepEqual(runs, ["c1", "c1", "c2"]);
  assert.deepEqual(reads, ["c1", "c1", "c2"]);
});

test("Distillation infrastructure failure is observed and counted fail-soft by the shared orchestrator", async () => {
  const observed: DistillationBackgroundObserverEvent[] = [];
  const orchestrator = createOrchestrator();
  const trigger = new DistillationBackgroundTrigger(
    orchestrator,
    {
      async getConversation() {
        return conversation();
      },
    },
    {
      async runOnce() {
        throw new TypeError("background failure");
      },
    },
    "G",
    {
      priority: "consolidation",
      cost: 1,
    },
    (event) => observed.push(event),
  );

  trigger.schedule({ userId: "u1", conversationId: "c1" });
  const summary = await orchestrator.drain();

  assert.equal(summary?.failed, 1);
  assert.deepEqual(observed, [{
    name: "distillation_background_error",
    userId: "u1",
    conversationId: "c1",
    errorName: "TypeError",
  }]);
});

test("missing conversation remains a harmless completed background no-op", async () => {
  const observed: DistillationBackgroundObserverEvent[] = [];
  const orchestrator = createOrchestrator();
  const trigger = new DistillationBackgroundTrigger(
    orchestrator,
    {
      async getConversation() {
        return null;
      },
    },
    {
      async runOnce() {
        throw new Error("must not run");
      },
    },
    "G",
    {
      priority: "consolidation",
      cost: 1,
    },
    (event) => observed.push(event),
  );

  trigger.schedule({ userId: "u1", conversationId: "gone" });
  const summary = await orchestrator.drain();

  assert.equal(summary?.completed, 1);
  assert.equal(summary?.failed, 0);
  assert.deepEqual(observed, [{
    name: "distillation_background_missing_conversation",
    userId: "u1",
    conversationId: "gone",
  }]);
});
