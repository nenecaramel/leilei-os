import assert from "node:assert/strict";
import test from "node:test";
import {
  BackgroundLoopOrchestrator,
} from "../src/domains/runtime/background/background-loop-orchestrator.js";
import {
  RuntimeEffectDeliveryWorker,
} from "../src/domains/runtime/effects/runtime-effect-delivery-worker.js";
import type {
  RuntimeEffectRecord,
} from "../src/domains/runtime/effects/runtime-effect-repository.js";

const userId = "22222222-2222-4222-8222-222222222222";
const effectId = "11111111-1111-4111-8111-111111111111";
const workerId = "33333333-3333-4333-8333-333333333333";

function effect(
  overrides: Partial<RuntimeEffectRecord> = {},
): RuntimeEffectRecord {
  return {
    effectId,
    userId,
    subjectId: "G",
    sourceWakeId:
      "44444444-4444-4444-8444-444444444444",
    decisionId: "decision-1",
    idempotencyKey: "a".repeat(64),
    effectType: "message_send",
    target:
      "conversation:55555555-5555-4555-8555-555555555555",
    payload: { text: "hello" },
    payloadHash: "b".repeat(64),
    status: "pending",
    attempt: 0,
    retryable: true,
    reservedBy: null,
    reservedAt: null,
    reservationExpiresAt: null,
    dispatchStartedAt: null,
    createdAt: "2026-09-23T10:00:00.000Z",
    updatedAt: "2026-09-23T10:00:00.000Z",
    observedAt: null,
    failureCode: null,
    ...overrides,
  };
}

test("effect delivery worker runs through shared orchestrator and marks canonical delivery observed", async () => {
  const calls: string[] = [];
  const orchestrator = new BackgroundLoopOrchestrator({
    maxRunsPerCycle: 4,
    maxCostPerCycle: 4,
    maxConcurrent: 2,
  });
  const pending = effect();
  const reserved = effect({
    status: "reserved",
    reservedBy: workerId,
    reservedAt: "2026-09-23T10:01:00.000Z",
    reservationExpiresAt:
      "2026-09-23T10:02:00.000Z",
  });
  const dispatching = effect({
    ...reserved,
    status: "dispatching",
    attempt: 1,
    dispatchStartedAt:
      "2026-09-23T10:01:10.000Z",
  });

  const worker = new RuntimeEffectDeliveryWorker(
    orchestrator,
    {
      async findNextUnknown() {
        calls.push("unknown:none");
        return null;
      },
      async findNextRetryableFailed() {
        return null;
      },
    },
    {
      async reserveNext() {
        calls.push("reserve");
        return {
          outcome: "reserved" as const,
          effect: reserved,
        };
      },
      async beginDispatch() {
        calls.push("begin");
        return {
          outcome: "dispatching" as const,
          effect: dispatching,
        };
      },
      async completeDispatch(input) {
        calls.push("complete:" + input.result.outcome);
        return effect({
          ...dispatching,
          status: "observed",
          retryable: false,
          reservedBy: null,
          reservedAt: null,
          reservationExpiresAt: null,
          observedAt:
            "2026-09-23T10:01:20.000Z",
        });
      },
      async reconcileUnknown() {
        throw new Error("unused");
      },
    },
    {
      async deliver() {
        calls.push("canonical");
        return {
          outcome: "observed" as const,
          messageId:
            "66666666-6666-4666-8666-666666666666",
        };
      },
      async reconcile() {
        throw new Error("unused");
      },
    },
    workerId,
    (event) => {
      calls.push("observer:" + event.name);
    },
  );

  worker.scheduleUser(userId);
  await orchestrator.drain();

  assert.deepEqual(calls, [
    "unknown:none",
    "reserve",
    "begin",
    "canonical",
    "complete:observed",
    "observer:runtime_effect_delivery_observed",
  ]);
  void pending;
});

test("unknown effect is reconciled from durable canonical mapping before any new reservation", async () => {
  const calls: string[] = [];
  const unknown = effect({
    status: "unknown",
    attempt: 1,
    retryable: false,
    dispatchStartedAt:
      "2026-09-23T10:01:00.000Z",
    failureCode: "DELIVERY_ADAPTER_ERROR",
  });

  const worker = new RuntimeEffectDeliveryWorker(
    {
      schedule() {
        throw new Error("unused");
      },
    },
    {
      async findNextUnknown() {
        calls.push("unknown");
        return unknown;
      },
      async findNextRetryableFailed() {
        return null;
      },
    },
    {
      async reserveNext() {
        calls.push("reserve");
        return { outcome: "idle" as const };
      },
      async beginDispatch() {
        throw new Error("unused");
      },
      async completeDispatch() {
        throw new Error("unused");
      },
      async reconcileUnknown(input) {
        calls.push(
          "reconcile:" + input.resolution.outcome,
        );
        return effect({
          ...unknown,
          status: "observed",
          observedAt:
            "2026-09-23T10:02:00.000Z",
          failureCode: null,
        });
      },
    },
    {
      async deliver() {
        throw new Error("unused");
      },
      async reconcile() {
        calls.push("mapping");
        return {
          outcome: "observed" as const,
          messageId:
            "66666666-6666-4666-8666-666666666666",
        };
      },
    },
    workerId,
    (event) => {
      calls.push(
        "observer:"
        + event.name
        + (
          event.name === "runtime_effect_delivery_reconciled"
            ? ":" + event.outcome
            : ""
        ),
      );
    },
  );

  await worker.runOne(userId);
  assert.deepEqual(calls, [
    "unknown",
    "mapping",
    "reconcile:observed",
    "observer:runtime_effect_delivery_reconciled:observed",
  ]);
});

test("ambiguous adapter failure becomes unknown instead of a blind retry", async () => {
  const calls: string[] = [];
  const reserved = effect({
    status: "reserved",
    reservedBy: workerId,
    reservedAt: "2026-09-23T10:01:00.000Z",
    reservationExpiresAt:
      "2026-09-23T10:02:00.000Z",
  });
  const dispatching = effect({
    ...reserved,
    status: "dispatching",
    attempt: 1,
    dispatchStartedAt:
      "2026-09-23T10:01:10.000Z",
  });

  const worker = new RuntimeEffectDeliveryWorker(
    { schedule() { throw new Error("unused"); } },
    {
      async findNextUnknown() { return null; },
      async findNextRetryableFailed() { return null; },
    },
    {
      async reserveNext() {
        return {
          outcome: "reserved" as const,
          effect: reserved,
        };
      },
      async beginDispatch() {
        return {
          outcome: "dispatching" as const,
          effect: dispatching,
        };
      },
      async completeDispatch(input) {
        calls.push(input.result.outcome);
        assert.equal(
          input.result.outcome,
          "unknown",
        );
        return effect({
          ...dispatching,
          status: "unknown",
          retryable: false,
          reservedBy: null,
          reservedAt: null,
          reservationExpiresAt: null,
          failureCode: "DELIVERY_ADAPTER_ERROR",
        });
      },
      async reconcileUnknown() {
        throw new Error("unused");
      },
    },
    {
      async deliver() {
        throw new Error("ambiguous commit result");
      },
      async reconcile() {
        throw new Error("unused");
      },
    },
    workerId,
  );

  await worker.runOne(userId);
  assert.deepEqual(calls, ["unknown"]);
});

test("known retryable canonical failure is explicitly requeued without blind unknown retry", async () => {
  const calls: string[] = [];
  const reserved = effect({
    status: "reserved",
    reservedBy: workerId,
    reservedAt: "2026-09-23T10:01:00.000Z",
    reservationExpiresAt:
      "2026-09-23T10:02:00.000Z",
  });
  const dispatching = effect({
    ...reserved,
    status: "dispatching",
    attempt: 1,
    dispatchStartedAt:
      "2026-09-23T10:01:10.000Z",
  });

  const worker = new RuntimeEffectDeliveryWorker(
    { schedule() { throw new Error("unused"); } },
    {
      async findNextUnknown() { return null; },
      async findNextRetryableFailed() { return null; },
    },
    {
      async reserveNext() {
        return {
          outcome: "reserved" as const,
          effect: reserved,
        };
      },
      async beginDispatch() {
        return {
          outcome: "dispatching" as const,
          effect: dispatching,
        };
      },
      async completeDispatch() {
        calls.push("failed");
        return effect({
          ...dispatching,
          status: "failed",
          retryable: true,
          reservedBy: null,
          reservedAt: null,
          reservationExpiresAt: null,
          failureCode: "TARGET_BUSY",
        });
      },
      async reconcileUnknown() {
        throw new Error("unused");
      },
      async requeueFailed() {
        calls.push("requeue");
        return effect({
          ...dispatching,
          status: "pending",
          retryable: true,
          reservedBy: null,
          reservedAt: null,
          reservationExpiresAt: null,
          dispatchStartedAt: null,
          failureCode: null,
        });
      },
    },
    {
      async deliver() {
        return {
          outcome: "failed" as const,
          failureCode: "TARGET_BUSY" as const,
          retryable: true as const,
        };
      },
      async reconcile() {
        throw new Error("unused");
      },
    },
    workerId,
  );

  await worker.runOne(userId);
  assert.deepEqual(calls, ["failed", "requeue"]);
});


test("recovery explicitly requeues a durable retryable failure before reserving new work", async () => {
  const calls: string[] = [];
  const retryableFailed = effect({
    status: "failed",
    attempt: 1,
    retryable: true,
    dispatchStartedAt:
      "2026-09-23T10:01:10.000Z",
    failureCode: "TARGET_BUSY",
  });

  const worker = new RuntimeEffectDeliveryWorker(
    { schedule() { throw new Error("unused"); } },
    {
      async findNextUnknown() {
        calls.push("unknown:none");
        return null;
      },
      async findNextRetryableFailed() {
        calls.push("failed");
        return retryableFailed;
      },
    },
    {
      async reserveNext() {
        calls.push("reserve");
        return { outcome: "idle" as const };
      },
      async beginDispatch() {
        throw new Error("unused");
      },
      async completeDispatch() {
        throw new Error("unused");
      },
      async reconcileUnknown() {
        throw new Error("unused");
      },
      async requeueFailed(input) {
        calls.push("requeue:" + input.effectId);
        return effect({
          ...retryableFailed,
          status: "pending",
          dispatchStartedAt: null,
          failureCode: null,
        });
      },
    },
    {
      async deliver() {
        throw new Error("unused");
      },
      async reconcile() {
        throw new Error("unused");
      },
    },
    workerId,
  );

  await worker.runOne(userId);
  assert.deepEqual(calls, [
    "unknown:none",
    "failed",
    "requeue:" + effectId,
  ]);
});


test("effect acknowledgement failure is not rewritten as a second unknown completion", async () => {
  const calls: string[] = [];
  const reserved = effect({
    status: "reserved",
    reservedBy: workerId,
    reservedAt: "2026-09-23T10:01:00.000Z",
    reservationExpiresAt:
      "2026-09-23T10:02:00.000Z",
  });
  const dispatching = effect({
    ...reserved,
    status: "dispatching",
    attempt: 1,
    dispatchStartedAt:
      "2026-09-23T10:01:10.000Z",
  });

  const worker = new RuntimeEffectDeliveryWorker(
    { schedule() { throw new Error("unused"); } },
    {
      async findNextUnknown() { return null; },
      async findNextRetryableFailed() { return null; },
    },
    {
      async reserveNext() {
        return {
          outcome: "reserved" as const,
          effect: reserved,
        };
      },
      async beginDispatch() {
        return {
          outcome: "dispatching" as const,
          effect: dispatching,
        };
      },
      async completeDispatch(input) {
        calls.push("complete:" + input.result.outcome);
        throw new Error("effect acknowledgement unavailable");
      },
      async reconcileUnknown() {
        throw new Error("unused");
      },
      async requeueFailed() {
        throw new Error("unused");
      },
    },
    {
      async deliver() {
        calls.push("canonical");
        return {
          outcome: "observed" as const,
          messageId:
            "66666666-6666-4666-8666-666666666666",
        };
      },
      async reconcile() {
        throw new Error("unused");
      },
    },
    workerId,
  );

  await assert.rejects(
    () => worker.runOne(userId),
    /effect acknowledgement unavailable/,
  );
  assert.deepEqual(calls, [
    "canonical",
    "complete:observed",
  ]);
});
