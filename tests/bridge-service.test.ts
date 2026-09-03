import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  BridgeDomainError,
  BridgeService,
  createBridgeModelContext,
} from "../src/domains/bridge/bridge-service.js";
import { composeBridgeDispatchContext } from "../src/mcp/tools/bridge-listener/listener-resource.js";
import type { BridgeEventRepository } from "../src/domains/bridge/bridge-event-repository.js";
import type {
  BridgeEventCreateInput,
  BridgeEventCreateResult,
  BridgeEventRecord,
  BridgeProcessingMutationResult,
  BridgeListenerLeaseResult,
} from "../src/domains/bridge/bridge-event-types.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const LISTENER_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-28T12:34:56.000Z");

function event(input: Partial<BridgeEventRecord> = {}): BridgeEventRecord {
  return {
    id: EVENT_ID,
    userId: USER_ID,
    idempotencyKey: "bridge-create-key-0001",
    requestHash: "a".repeat(64),
    kind: "chat",
    source: "leileios_pwa",
    visibleText: "hello",
    modelContext: "safe context",
    status: "pending",
    createdAt: NOW,
    reservedBy: LISTENER_ID,
    reservedAt: NOW,
    reservationExpiresAt: NOW,
    dispatchStartedAt: null,
    hostSentAt: null,
    deliveryUnknownAt: null,
    processingState: "unclaimed",
    modelClaimedAt: null,
    modelCompletedAt: null,
    deliveryReconciledAt: null,
    retryCount: 0,
    lastErrorCode: null,
    ...input,
  };
}

class FakeBridgeEventRepository implements BridgeEventRepository {
  readonly creates: Array<{ userId: string; input: BridgeEventCreateInput }> = [];
  readonly lifecycleCalls: Array<{ name: string; args: unknown[] }> = [];
  createResult: BridgeEventCreateResult = { outcome: "created", event: event() };
  leaseResult: BridgeListenerLeaseResult = { state: "acquired" };
  next: BridgeEventRecord | null = null;
  callbackResult: BridgeEventRecord | null = event();
  processingResult: BridgeProcessingMutationResult = { outcome: "applied", event: event({ status: "host_sent" }) };

  async createEvent(userId: string, input: BridgeEventCreateInput): Promise<BridgeEventCreateResult> {
    this.creates.push({ userId, input });
    return this.createResult;
  }

  async getEvent(userId: string, eventId: string): Promise<BridgeEventRecord | null> {
    this.lifecycleCalls.push({ name: "getEvent", args: [userId, eventId] });
    return event({ id: eventId, userId });
  }

  async acquireListenerLease(userId: string, listenerInstanceId: string): Promise<BridgeListenerLeaseResult> {
    this.lifecycleCalls.push({ name: "acquireListenerLease", args: [userId, listenerInstanceId] });
    return this.leaseResult;
  }

  async releaseListenerLease(userId: string, listenerInstanceId: string): Promise<boolean> {
    this.lifecycleCalls.push({ name: "releaseListenerLease", args: [userId, listenerInstanceId] });
    return true;
  }

  async reserveNext(userId: string, listenerInstanceId: string): Promise<BridgeEventRecord | null> {
    this.lifecycleCalls.push({ name: "reserveNext", args: [userId, listenerInstanceId] });
    return this.next;
  }

  async markDispatchStarted(userId: string, listenerInstanceId: string, eventId: string): Promise<BridgeEventRecord | null> {
    this.lifecycleCalls.push({ name: "markDispatchStarted", args: [userId, listenerInstanceId, eventId] });
    return this.callbackResult;
  }

  async markHostSent(userId: string, listenerInstanceId: string, eventId: string): Promise<BridgeEventRecord | null> {
    this.lifecycleCalls.push({ name: "markHostSent", args: [userId, listenerInstanceId, eventId] });
    return this.callbackResult;
  }

  async markDeliveryUnknown(userId: string, listenerInstanceId: string, eventId: string, code: string): Promise<BridgeEventRecord | null> {
    this.lifecycleCalls.push({ name: "markDeliveryUnknown", args: [userId, listenerInstanceId, eventId, code] });
    return this.callbackResult;
  }

  async release(userId: string, listenerInstanceId: string, eventId: string, code?: string): Promise<BridgeEventRecord | null> {
    this.lifecycleCalls.push({ name: "release", args: [userId, listenerInstanceId, eventId, code] });
    return this.callbackResult;
  }

  async claimProcessing(userId: string, eventId: string): Promise<BridgeProcessingMutationResult> {
    this.lifecycleCalls.push({ name: "claimProcessing", args: [userId, eventId] });
    return this.processingResult;
  }

  async completeProcessing(userId: string, eventId: string): Promise<BridgeProcessingMutationResult> {
    this.lifecycleCalls.push({ name: "completeProcessing", args: [userId, eventId] });
    return this.processingResult;
  }

  async deleteTerminalBatch(): Promise<number> {
    return 0;
  }
}

function createService(repository = new FakeBridgeEventRepository()) {
  return {
    repository,
    service: new BridgeService(repository, {
      createId: () => EVENT_ID,
      now: () => NOW,
    }),
  };
}

test("normalizes Bridge text before hashing and persistence", async () => {
  const { repository, service } = createService();

  await service.createPwaEvent(USER_ID, " \r\nhello\r\n ", "bridge-create-key-0001");

  assert.equal(repository.creates.length, 1);
  assert.equal(repository.creates[0]?.userId, USER_ID);
  assert.equal(repository.creates[0]?.input.visibleText, "hello");
  assert.equal(repository.creates[0]?.input.id, EVENT_ID);
  assert.equal(repository.creates[0]?.input.createdAt, NOW);
  assert.match(repository.creates[0]?.input.requestHash ?? "", /^[a-f0-9]{64}$/);
});

test("rejects blank or oversized Bridge text without persistence", async () => {
  const { repository, service } = createService();

  for (const text of ["\n \r\t", "a".repeat(4_001)]) {
    await assert.rejects(
      service.createPwaEvent(USER_ID, text, "bridge-create-key-0001"),
      (error: unknown) => error instanceof BridgeDomainError && error.code === "INVALID_INPUT",
    );
  }

  assert.equal(repository.creates.length, 0);
});

test("rejects idempotency keys outside the shared safe format", async () => {
  const { repository, service } = createService();

  for (const key of ["too-short", "a".repeat(129), "bridge key has spaces"]) {
    await assert.rejects(
      service.createPwaEvent(USER_ID, "hello", key),
      (error: unknown) => error instanceof BridgeDomainError && error.code === "INVALID_INPUT",
    );
  }

  assert.equal(repository.creates.length, 0);
});

test("uses a deterministic versioned request hash and compact safe model context", async () => {
  const { repository, service } = createService();

  await service.createPwaEvent(USER_ID, "hello", "bridge-create-key-0001");
  const input = repository.creates[0]?.input;
  const expectedHash = createHash("sha256")
    .update(
      "leilei-os:bridge-event:v1\n" +
        JSON.stringify({ kind: "chat", source: "leileios_pwa", text: "hello" }),
      "utf8",
    )
    .digest("hex");

  assert.equal(input?.requestHash, expectedHash);
  assert.match(input?.modelContext ?? "", new RegExp(EVENT_ID));
  assert.match(input?.modelContext ?? "", /leileios_pwa/);
  assert.match(input?.modelContext ?? "", /chat/);
  assert.match(input?.modelContext ?? "", /2026-08-28T12:34:56.000Z/);
  assert.match(input?.modelContext ?? "", /@LeileiOS/);
  assert.doesNotMatch(input?.modelContext ?? "", /Memory|Diary|Todo|secret|hello/i);
});

test("Bridge model context uses factual route metadata", () => {
  const modelContext = createBridgeModelContext({
    eventId: EVENT_ID,
    createdAt: NOW,
    kind: "chat",
    source: "leileios_pwa",
  });

  assert.match(modelContext, /Visible route hint:/);
  assert.doesNotMatch(modelContext, /Route the visible user message through/i);

  const composed = composeBridgeDispatchContext({ id: EVENT_ID, modelContext });
  assert.doesNotMatch(composed, /Route the visible user message through/i);
});

test("returns replayed events and maps idempotency conflicts to a stable safe code", async () => {
  const replay = event({ status: "host_sent" });
  const { repository, service } = createService();
  repository.createResult = { outcome: "replayed", event: replay };

  const result = await service.createPwaEvent(USER_ID, "hello", "bridge-create-key-0001");
  assert.equal(result.created, false);
  assert.equal(result.event, replay);

  repository.createResult = { outcome: "conflict" };
  await assert.rejects(
    service.createPwaEvent(USER_ID, "private-payload-sentinel", "bridge-create-key-0001"),
    (error: unknown) => error instanceof BridgeDomainError && error.code === "IDEMPOTENCY_CONFLICT" && !error.message.includes("private-payload-sentinel"),
  );
});

test("threads authenticated ownership and listener identity through lifecycle calls", async () => {
  const { repository, service } = createService();
  repository.next = event({ status: "reserved" });

  assert.equal((await service.startListener(USER_ID, LISTENER_ID)).state, "acquired");
  assert.equal(await service.stopListener(USER_ID, LISTENER_ID), true);
  assert.equal((await service.reserveNext(USER_ID, LISTENER_ID))?.id, EVENT_ID);
  await service.markDispatchStarted(USER_ID, LISTENER_ID, EVENT_ID);
  await service.markHostSent(USER_ID, LISTENER_ID, EVENT_ID);
  await service.markDeliveryUnknown(USER_ID, LISTENER_ID, EVENT_ID, "HOST_TIMEOUT");
  await service.release(USER_ID, LISTENER_ID, EVENT_ID, "HOST_REJECTED");

  assert.deepEqual(repository.lifecycleCalls.map(({ name, args }) => ({ name, args })), [
    { name: "acquireListenerLease", args: [USER_ID, LISTENER_ID] },
    { name: "releaseListenerLease", args: [USER_ID, LISTENER_ID] },
    { name: "reserveNext", args: [USER_ID, LISTENER_ID] },
    { name: "markDispatchStarted", args: [USER_ID, LISTENER_ID, EVENT_ID] },
    { name: "markHostSent", args: [USER_ID, LISTENER_ID, EVENT_ID] },
    { name: "markDeliveryUnknown", args: [USER_ID, LISTENER_ID, EVENT_ID, "HOST_TIMEOUT"] },
    { name: "release", args: [USER_ID, LISTENER_ID, EVENT_ID, "HOST_REJECTED"] },
  ]);
});

test("permits reserved-owner terminal callbacks after listener lease expiry", async () => {
  const { repository, service } = createService();
  repository.callbackResult = event({ status: "host_sent" });

  const result = await service.markHostSent(USER_ID, LISTENER_ID, EVENT_ID);

  assert.equal(result.status, "host_sent");
  assert.equal(repository.lifecycleCalls[0]?.name, "markHostSent");
});

test("maps unavailable reservations and non-owner lifecycle transitions to safe domain errors", async () => {
  const { repository, service } = createService();
  repository.leaseResult = { state: "busy" };

  await assert.rejects(
    service.startListener(USER_ID, LISTENER_ID),
    (error: unknown) => error instanceof BridgeDomainError && error.code === "LISTENER_BUSY",
  );

  repository.callbackResult = null;
  await assert.rejects(
    service.markDeliveryUnknown(USER_ID, LISTENER_ID, EVENT_ID, "HOST_TIMEOUT"),
    (error: unknown) => error instanceof BridgeDomainError && error.code === "EVENT_CONFLICT",
  );
});

test("maps processing outcomes without leaking event payloads", async () => {
  const observed: unknown[] = [];
  const repository = new FakeBridgeEventRepository();
  const processingService = new BridgeService(repository, { observe: (entry) => observed.push(entry) });

  const claimed = await processingService.claimEvent(USER_ID, EVENT_ID);
  assert.equal(claimed, repository.processingResult.event);
  assert.deepEqual(repository.lifecycleCalls.at(-1), { name: "claimProcessing", args: [USER_ID, EVENT_ID] });

  repository.processingResult = { outcome: "idempotent", event: event({ status: "host_sent", processingState: "claimed", modelClaimedAt: NOW }) };
  const completed = await processingService.completeEvent(USER_ID, EVENT_ID);
  assert.equal(completed, repository.processingResult.event);

  for (const outcome of ["not_found", "conflict"] as const) {
    repository.processingResult = { outcome };
    await assert.rejects(
      processingService.claimEvent(USER_ID, EVENT_ID),
      (error: unknown) => error instanceof BridgeDomainError && error.code === (outcome === "not_found" ? "EVENT_NOT_FOUND" : "PROCESSING_CONFLICT"),
    );
  }

  assert.deepEqual(repository.lifecycleCalls.slice(-3).map(({ name, args }) => ({ name, args })), [
    { name: "completeProcessing", args: [USER_ID, EVENT_ID] },
    { name: "claimProcessing", args: [USER_ID, EVENT_ID] },
    { name: "claimProcessing", args: [USER_ID, EVENT_ID] },
  ]);
  assert.ok(observed.some((entry) => (entry as { name?: string }).name === "bridge_event_processing_claimed"));
  assert.ok(observed.some((entry) => (entry as { name?: string }).name === "bridge_event_processing_completed"));
  assert.doesNotMatch(JSON.stringify(observed), /private|secret|modelContext|visibleText/);
});
