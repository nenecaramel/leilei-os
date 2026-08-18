import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import {
  createAckToyCommandHandler,
  createClaimToyCommandHandler,
  createToyBridgeRouter,
  createToyCommandHandler,
} from "../src/web-api/toy-router.js";
import { createToyBridgeAuthMiddleware } from "../src/web-api/toy-bridge-auth.js";

function recorder() {
  const result: { status?: number; body?: unknown; headers: Record<string, string>; sent?: boolean } = { headers: {} };
  const response = {
    setHeader(name: string, value: string) { result.headers[name.toLowerCase()] = value; return response; },
    status(value: number) { result.status = value; return response; },
    json(value: unknown) { result.body = value; return response; },
    send() { result.sent = true; return response; },
  } as unknown as Response;
  return { result, response };
}

const command = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  action: "set" as const,
  percent: 40,
  durationSeconds: 60,
  status: "pending" as const,
  createdAt: new Date("2026-07-26T10:00:00Z"),
  expiresAt: new Date("2026-07-26T10:00:10Z"),
  claimedAt: null,
  completedAt: null,
  expiredAt: null,
  error: null,
};

test("create handler uses authenticated Web user and returns only public command fields", async () => {
  const calls: unknown[] = [];
  const handler = createToyCommandHandler({ toyService: {
    async create(userId, input) { calls.push({ userId, input }); return command; },
    async claim() { return null; },
    async ack() { return command; },
  } });
  const { result, response } = recorder();
  await handler({ webUserId: command.userId, body: { action: "set", percent: 40 } } as Request, response, () => {});
  assert.equal(result.status, 201);
  assert.deepEqual(calls, [{ userId: command.userId, input: { action: "set", percent: 40 } }]);
  assert.equal(result.headers["cache-control"], "private, no-store");
  assert.ok(!JSON.stringify(result.body).includes(command.userId));
});

test("bridge claim carries duration only for set commands and preserves the 10-second TTL", async () => {
  const calls: string[] = [];
  const setCommand = { ...command, durationSeconds: 1200 };
  const handler = createClaimToyCommandHandler({ toyService: {
    async create() { return command; },
    async claim() { calls.push("claim"); return setCommand; },
    async ack() { return command; },
  } });
  const { result, response } = recorder();

  await handler({ body: {} } as Request, response, () => {});

  assert.deepEqual(calls, ["claim"]);
  assert.deepEqual(result.body, {
    success: true,
    data: {
      id: command.id,
      action: "set",
      percent: command.percent,
      durationSeconds: 1200,
      expiresAt: "2026-07-26T10:00:10.000Z",
    },
  });
});

test("claim returns 204 when empty and rejects a non-empty body", async () => {
  let claims = 0;
  const handler = createClaimToyCommandHandler({ toyService: {
    async create() { return command; },
    async claim() { claims += 1; return null; },
    async ack() { return command; },
  } });
  const empty = recorder();
  await handler({ body: {} } as Request, empty.response, () => {});
  assert.equal(empty.result.status, 204);
  assert.equal(empty.result.headers["cache-control"], "no-store");

  const invalid = recorder();
  await handler({ body: { user_id: command.userId } } as Request, invalid.response, () => {});
  assert.equal(invalid.result.status, 400);
  assert.equal(claims, 1);
});

test("ack forwards only route id and body and returns no private command data", async () => {
  const calls: unknown[] = [];
  const completed = { ...command, status: "completed" as const, completedAt: new Date("2026-07-26T10:00:05Z") };
  const handler = createAckToyCommandHandler({ toyService: {
    async create() { return command; },
    async claim() { return null; },
    async ack(id, input) { calls.push({ id, input }); return completed; },
  } });
  const { result, response } = recorder();
  await handler({ params: { id: command.id }, body: { status: "completed" } } as unknown as Request, response, () => {});
  assert.deepEqual(calls, [{ id: command.id, input: { status: "completed" } }]);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.ok(!JSON.stringify(result.body).includes(command.userId));
});

test("bridge auth is generic, fail-closed and uses the dedicated header", () => {
  const key = "a".repeat(64);
  const middleware = createToyBridgeAuthMiddleware(key);
  for (const supplied of [undefined, "b".repeat(64), "c".repeat(4096)]) {
    const { result, response } = recorder();
    let next = false;
    middleware({ header: () => supplied } as unknown as Request, response, (() => { next = true; }) as NextFunction);
    assert.equal(next, false);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Bridge authentication failed." },
    });
  }

  const valid = recorder();
  let next = false;
  middleware({ header: (name) => name.toLowerCase() === "x-leilei-bridge-key" ? key : undefined } as Request, valid.response, (() => { next = true; }) as NextFunction);
  assert.equal(next, true);

  const disabled = recorder();
  createToyBridgeAuthMiddleware(undefined)(
    { header: () => key } as unknown as Request,
    disabled.response,
    (() => {}) as NextFunction,
  );
  assert.equal(disabled.result.status, 503);
  assert.ok(!JSON.stringify(disabled.result.body).includes(key));
});

test("bridge router does not intercept the Auth0-protected create path", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/toy/commands",
    createToyBridgeRouter({
      toyService: {
        async create() { return command; },
        async claim() { return null; },
        async ack() { return command; },
      },
    }, undefined),
  );
  app.post("/api/v1/toy/commands", (_request, response) => {
    response.status(201).json({ reachedWebAuthRoute: true });
  });

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/toy/commands`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { reachedWebAuthRoute: true });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
