import assert from "node:assert/strict";
import test from "node:test";
import type { NativeLiveConversation } from "../src/domains/conversation/native-live-conversation-types.js";
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

test("background trigger is non-blocking, globally serialized, and coalesces repeated conversation triggers", async () => {
  const reads: string[] = [];
  const runs: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const trigger = new DistillationBackgroundTrigger(
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

test("background model or repository failure is observed but never escapes drain", async () => {
  const observed: DistillationBackgroundObserverEvent[] = [];
  const trigger = new DistillationBackgroundTrigger(
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
    (event) => observed.push(event),
  );

  trigger.schedule({ userId: "u1", conversationId: "c1" });
  await trigger.drain();

  assert.deepEqual(observed, [{
    name: "distillation_background_error",
    userId: "u1",
    conversationId: "c1",
    errorName: "TypeError",
  }]);
});

test("missing conversation is a harmless background no-op", async () => {
  const observed: DistillationBackgroundObserverEvent[] = [];
  const trigger = new DistillationBackgroundTrigger(
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
    (event) => observed.push(event),
  );

  trigger.schedule({ userId: "u1", conversationId: "gone" });
  await trigger.drain();

  assert.deepEqual(observed, [{
    name: "distillation_background_missing_conversation",
    userId: "u1",
    conversationId: "gone",
  }]);
});
