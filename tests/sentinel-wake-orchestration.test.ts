import assert from "node:assert/strict";
import test from "node:test";
import { SentinelService } from "../src/domains/sentinel/sentinel-service.js";
import type { SentinelRecord, SentinelWakeRunRecord } from "../src/domains/sentinel/sentinel-types.js";
import type { BridgeEventRecord } from "../src/domains/bridge/bridge-event-types.js";

const NOW = new Date("2026-08-29T00:00:00.000Z");

function sentinel(): SentinelRecord {
  return {
    id: "sentinel-1",
    userId: "user-1",
    enabled: true,
    timezone: "UTC",
    policyPrompt: "",
    nextWakeAt: new Date("2026-08-29T01:00:00.000Z"),
    lastValidWakeAt: null,
    wakeContextCapsule: null,
    wakeContextUpdatedAt: null,
    controlRevision: 4,
    activeWakeRunId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function bridge(id = "bridge-1", overrides: Partial<BridgeEventRecord> = {}): BridgeEventRecord {
  return {
    id,
    userId: "user-1",
    idempotencyKey: "sentinel-wake-wake-1",
    requestHash: "a".repeat(64),
    kind: "wake",
    source: "leileios_sentinel",
    visibleText: "[LeileiOS Sentinel wake]",
    modelContext: "bounded wake context",
    status: "pending",
    createdAt: NOW,
    reservedBy: null,
    reservedAt: null,
    reservationExpiresAt: null,
    dispatchStartedAt: null,
    hostSentAt: null,
    deliveryUnknownAt: null,
    processingState: "unclaimed",
    modelClaimedAt: null,
    modelCompletedAt: null,
    deliveryReconciledAt: null,
    retryCount: 0,
    lastErrorCode: null,
    ...overrides,
  };
}

function wake(id = "wake-1"): SentinelWakeRunRecord {
  return {
    id,
    sentinelId: "sentinel-1",
    userId: "user-1",
    controlRevision: 4,
    cause: "scheduled",
    scheduledFor: NOW,
    triggeredAt: NOW,
    bridgeEventId: "bridge-1",
    state: "bridge_enqueued",
    decision: null,
    nextWakeAt: null,
    completionPayloadHash: null,
    claimedAt: null,
    finalizedAt: null,
    failureCode: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

test("enqueueWake atomically exposes a wake event and consumes the old schedule", async () => {
  const owner = sentinel();
  const calls: unknown[] = [];
  const repository = {
    findByUserId: async () => owner,
    createWakeWithBridge: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { outcome: "created", wake: wake(), bridge: bridge() };
    },
  } as never;
  const service = new SentinelService(repository);

  const result = await service.enqueueWake("user-1", {
    cause: "scheduled",
    scheduledFor: NOW,
    wakeId: "wake-1",
  });

  assert.equal(result.outcome, "created");
  assert.equal(result.wake.state, "bridge_enqueued");
  assert.equal(result.bridge.kind, "wake");
  assert.equal(result.bridge.source, "leileios_sentinel");
  assert.equal(result.bridge.visibleText, "[LeileiOS Sentinel wake]");
  assert.equal((calls[0] as { clearNextWakeAt: boolean }).clearNextWakeAt, true);
  assert.equal((calls[0] as { wakeId: string }).wakeId, "wake-1");
});

test("same wake id replays the deterministic Bridge identity and cancellation is pre-dispatch only", async () => {
  const owner = sentinel();
  const calls: unknown[] = [];
  const repository = {
    findByUserId: async () => owner,
    createWakeWithBridge: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { outcome: "idempotent", wake: wake(), bridge: bridge() };
    },
    cancelWakeBeforeDispatch: async () => ({ outcome: "cancelled", wake: wake(), bridge: bridge("bridge-cancelled", { cancelledAt: NOW }) }),
  } as never;
  const service = new SentinelService(repository);

  const replay = await service.enqueueWake("user-1", {
    cause: "wake_now",
    scheduledFor: NOW,
    wakeId: "wake-1",
  });
  assert.equal(replay.outcome, "idempotent");
  assert.equal((calls[0] as { bridgeIdempotencyKey: string }).bridgeIdempotencyKey, "sentinel-wake-wake-1");

  const cancelled = await service.cancelWakeBeforeDispatch("user-1", "wake-1");
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.bridge.cancelledAt instanceof Date, true);
});
