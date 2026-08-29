import assert from "node:assert/strict";
import test from "node:test";
import { BridgeService } from "../src/domains/bridge/bridge-service.js";
import type { BridgeEventRepository } from "../src/domains/bridge/bridge-event-repository.js";
import type { BridgeEventRecord, BridgeProcessingMutationResult } from "../src/domains/bridge/bridge-event-types.js";
import { createBridgeObserver, projectBridgeEvent } from "../src/observability/runtime-observers.js";

test("bridge observer projects safe lifecycle fields only", () => {
  const event = { name: "bridge_event_created" as const, eventId: "event-1", status: "pending" as const };
  const projected = projectBridgeEvent(event);
  assert.deepEqual(projected, { eventId: "event-1", status: "pending" });
  assert.doesNotMatch(JSON.stringify(projected), /visibleText|modelContext|idempotency|secret/);
});

test("bridge service emits lifecycle events without message payloads", async () => {
  const observed: unknown[] = [];
  const repository = {
    createEvent: async (_userId: string, input: never) => ({ outcome: "created", event: { id: input.id, status: "pending", createdAt: input.createdAt } }) as never,
  } as never;
  const service = new BridgeService(repository, { createId: () => "00000000-0000-4000-8000-000000000001", observe: (event) => observed.push(event) });
  await service.createPwaEvent("user-1", "private message", "bridge-observe-event-0001");
  assert.equal(observed.length, 1);
  assert.doesNotMatch(JSON.stringify(observed), /private message|model context|bridge-observe-event-0001/);
});

test("bridge processing observability records safe outcomes, races, reconciliation, and latency", async () => {
  const observed: unknown[] = [];
  const createdAt = new Date("2026-08-28T00:00:00.000Z");
  const claimedAt = new Date("2026-08-28T00:00:02.500Z");
  const completedAt = new Date("2026-08-28T00:00:07.000Z");
  const baseEvent = {
    id: "33333333-3333-4333-8333-333333333333",
    createdAt,
    modelClaimedAt: claimedAt,
    modelCompletedAt: completedAt,
    deliveryReconciledAt: null,
    processingState: "claimed" as const,
    status: "reserved" as const,
    dispatchStartedAt: new Date("2026-08-28T00:00:01.000Z"),
    hostSentAt: null,
  } as BridgeEventRecord;
  let claimResult: BridgeProcessingMutationResult = { outcome: "applied", event: baseEvent };
  let completeResult: BridgeProcessingMutationResult = { outcome: "applied", event: { ...baseEvent, processingState: "completed" } };
  let callbackEvent = { ...baseEvent, status: "delivery_unknown" as const, deliveryUnknownAt: completedAt, deliveryReconciledAt: completedAt };
  const repository = {
    claimProcessing: async () => claimResult,
    completeProcessing: async () => completeResult,
    markDeliveryUnknown: async () => callbackEvent,
  } as unknown as BridgeEventRepository;
  const service = new BridgeService(repository, { observe: (event) => observed.push(event) });

  await service.claimEvent("user-1", baseEvent.id);
  const dispatchedClaim = observed.at(-1) as Record<string, unknown>;
  assert.equal(dispatchedClaim.outcome, "applied");
  assert.equal(dispatchedClaim.transportStatus, "reserved");
  assert.equal(dispatchedClaim.awaitingHostCallback, true);
  assert.equal(dispatchedClaim.claimLatencyMs, 2_500);

  claimResult = {
    outcome: "idempotent",
    event: { ...baseEvent, status: "delivery_unknown", deliveryReconciledAt: completedAt },
  };
  await service.claimEvent("user-1", baseEvent.id);
  const priorEvidence = observed.at(-1) as Record<string, unknown>;
  assert.equal(priorEvidence.outcome, "idempotent");
  assert.equal(priorEvidence.reconciliation, "later_model_evidence");

  await service.markDeliveryUnknown("user-1", "listener-1", baseEvent.id, "HOST_TIMEOUT");
  const laterEvidence = observed.at(-1) as Record<string, unknown>;
  assert.equal(laterEvidence.reconciliation, "prior_model_evidence");

  await service.completeEvent("user-1", baseEvent.id);
  const completion = observed.at(-1) as Record<string, unknown>;
  assert.equal(completion.outcome, "applied");
  assert.equal(completion.completionLatencyMs, 4_500);

  claimResult = { outcome: "conflict" };
  await assert.rejects(service.claimEvent("user-1", baseEvent.id));
  const conflict = observed.at(-1) as Record<string, unknown>;
  assert.equal(conflict.outcome, "conflict");

  const logs: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  const logger = { debug() {}, info(event: string, fields?: Record<string, unknown>) { logs.push({ event, fields }); }, warn() {}, error() {} };
  createBridgeObserver(logger)(observed[0] as never);
  assert.equal(logs[0]?.fields?.claimLatencyMs, 2_500);
  assert.doesNotMatch(JSON.stringify(logs), /visibleText|modelContext|private|secret/);
});
