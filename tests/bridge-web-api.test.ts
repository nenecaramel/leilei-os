import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { BridgeDomainError } from "../src/domains/bridge/bridge-service.js";
import type { BridgeEventRecord } from "../src/domains/bridge/bridge-event-types.js";
import { createWebApiRouter } from "../src/web-api/router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000100";

type CreateResult = { event: BridgeEventRecord; created: boolean };

function bridgeEvent(input: Partial<BridgeEventRecord> = {}): BridgeEventRecord {
  return {
    id: "bridge-event-1",
    userId: USER_ID,
    idempotencyKey: "bridge-web-event-0001",
    requestHash: "a".repeat(64),
    kind: "chat",
    source: "leileios_pwa",
    visibleText: "private bridge text",
    modelContext: "private model context",
    status: "pending",
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
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
    ...input,
  };
}

class FakeBridgeService {
  readonly createCalls: Array<{ userId: string; text: unknown; idempotencyKey: unknown }> = [];
  readonly readCalls: Array<{ userId: string; eventId: string }> = [];
  createResult: CreateResult = { event: bridgeEvent(), created: true };
  readResult: BridgeEventRecord = bridgeEvent();
  createError: unknown;
  readError: unknown;

  async createPwaEvent(userId: string, text: unknown, idempotencyKey: unknown): Promise<CreateResult> {
    this.createCalls.push({ userId, text, idempotencyKey });
    if (this.createError) throw this.createError;
    return this.createResult;
  }

  async getEvent(userId: string, eventId: string): Promise<BridgeEventRecord> {
    this.readCalls.push({ userId, eventId });
    if (this.readError) throw this.readError;
    return this.readResult;
  }
}

async function withServer(
  bridgeService: FakeBridgeService,
  callback: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    const requestedUser = request.header("x-test-user");
    if (requestedUser === "owner") request.webUserId = USER_ID;
    if (requestedUser === "other") request.webUserId = OTHER_USER_ID;
    next();
  });
  app.use(
    "/api/v1",
    createWebApiRouter({
      memory: { memoryService: {} as never },
      diary: { diaryService: {} as never },
      task: { taskService: {} as never },
      toy: { toyService: {} as never },
      system: { systemService: {} as never },
      bridge: { bridgeService },
    } as never),
  );
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address() as AddressInfo;
  try {
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("Bridge ingress is authenticated, server-owned, strict, and returns compact idempotent state", async () => {
  const service = new FakeBridgeService();
  await withServer(service, async (baseUrl) => {
    const unauthenticated = await fetch(`${baseUrl}/api/v1/bridge/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "bridge-web-event-0001" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(unauthenticated.status, 401);

    const rejected = await fetch(`${baseUrl}/api/v1/bridge/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "owner", "idempotency-key": "bridge-web-event-0001" },
      body: JSON.stringify({ text: "hello", userId: OTHER_USER_ID }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(service.createCalls.length, 0);

    const missingKey = await fetch(`${baseUrl}/api/v1/bridge/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "owner" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(missingKey.status, 400);
    assert.equal(service.createCalls.length, 0);

    const created = await fetch(`${baseUrl}/api/v1/bridge/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "owner", "idempotency-key": "bridge-web-event-0001" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await created.json(), {
      success: true,
      data: { id: "bridge-event-1", status: "pending", createdAt: "2026-08-28T00:00:00.000Z" },
    });
    assert.deepEqual(service.createCalls, [{ userId: USER_ID, text: "hello", idempotencyKey: "bridge-web-event-0001" }]);

    service.createResult = { event: bridgeEvent(), created: false };
    const replayed = await fetch(`${baseUrl}/api/v1/bridge/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "owner", "idempotency-key": "bridge-web-event-0001" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(replayed.status, 200);
    assert.deepEqual((await replayed.json()).data, {
      id: "bridge-event-1", status: "pending", createdAt: "2026-08-28T00:00:00.000Z",
    });
  });
});

test("Bridge ingress maps safe errors and never exposes submitted text", async () => {
  const service = new FakeBridgeService();
  await withServer(service, async (baseUrl) => {
    for (const [error, status, code] of [
      [new BridgeDomainError("INVALID_INPUT", "secret text detail"), 400, "INVALID_BRIDGE_EVENT"],
      [new BridgeDomainError("IDEMPOTENCY_CONFLICT", "secret text detail"), 409, "IDEMPOTENCY_CONFLICT"],
      [new Error("private bridge text"), 503, "BRIDGE_UNAVAILABLE"],
    ] as const) {
      service.createError = error;
      const response = await fetch(`${baseUrl}/api/v1/bridge/events`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user": "owner", "idempotency-key": "bridge-web-event-0001" },
        body: JSON.stringify({ text: "private bridge text" }),
      });
      assert.equal(response.status, status);
      const payload = await response.json() as { error: { code: string } };
      assert.equal(payload.error.code, code);
      assert.doesNotMatch(JSON.stringify(payload), /private bridge text|secret text detail/);
    }
  });
});

test("Bridge event readback is compact and owner scoped", async () => {
  const service = new FakeBridgeService();
  await withServer(service, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/bridge/events/bridge-event-1`, {
      headers: { "x-test-user": "owner" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: { id: "bridge-event-1", status: "pending", createdAt: "2026-08-28T00:00:00.000Z" },
    });
    assert.deepEqual(service.readCalls, [{ userId: USER_ID, eventId: "bridge-event-1" }]);

    service.readError = new BridgeDomainError("EVENT_NOT_FOUND", "secret owner details");
    const denied = await fetch(`${baseUrl}/api/v1/bridge/events/bridge-event-1`, {
      headers: { "x-test-user": "other" },
    });
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), {
      success: false,
      error: { code: "BRIDGE_EVENT_NOT_FOUND", message: "Bridge event was not found." },
    });
  });
});
