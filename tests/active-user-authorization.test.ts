import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  ActiveUserAuthorizationError,
} from "../src/domains/require-active-user.js";
import type {
  ToyAckInput,
  ToyCommandRecord,
  ToyCreateInput,
} from "../src/domains/toy/toy-command-types.js";
import type {
  ToyAckRepositoryResult,
  ToyCommandRepository,
  ToyIdempotentCreateResult,
} from "../src/domains/toy/toy-command-repository.js";
import { ToyCommandService } from "../src/domains/toy/toy-command-service.js";
import { createToyUserRouter } from "../src/web-api/toy-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

class FakeToyRepository implements ToyCommandRepository {
  status: "active" | "disabled" | null = "disabled";
  creates = 0;
  idempotentCreates = 0;
  claims = 0;
  acks = 0;

  async findUserById() {
    return this.status ? { status: this.status } : null;
  }

  async create(userId: string, input: ToyCreateInput) {
    this.creates += 1;
    return toyRecord(userId, input);
  }

  async createIdempotently(userId: string, input: ToyCreateInput & { toolName: "toy_set" | "toy_stop"; idempotencyKey: string; requestHash: string }): Promise<ToyIdempotentCreateResult> {
    this.idempotentCreates += 1;
    return { outcome: "created", command: toyRecord(userId, input) };
  }

  async claim(userId: string) {
    this.claims += 1;
    return toyRecord(userId, { action: "stop" });
  }

  async ack(_userId: string, _id: string, _input: ToyAckInput): Promise<ToyAckRepositoryResult> {
    this.acks += 1;
    return { kind: "updated", command: toyRecord(USER_ID, { action: "stop" }) };
  }
}

function toyRecord(userId: string, input: ToyCreateInput): ToyCommandRecord {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    userId,
    action: input.action,
    percent: input.action === "set" ? input.percent : null,
    durationSeconds: input.action === "set" ? input.durationSeconds ?? 60 : null,
    status: "pending",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2026-08-01T00:00:10.000Z"),
    claimedAt: null,
    completedAt: null,
    expiredAt: null,
    error: null,
  };
}

test("Toy rejects disabled bound users before Web, MCP, claim, or ack mutations", async () => {
  const repository = new FakeToyRepository();
  const service = new ToyCommandService(repository, USER_ID);
  for (const operation of [
    () => service.create(USER_ID, { action: "stop" }),
    () => service.createIdempotently(USER_ID, { action: "stop" }, "toy-auth-test-0001"),
    () => service.claim(),
    () => service.ack("33333333-3333-4333-8333-333333333333", { status: "completed" }),
  ]) {
    await assert.rejects(operation, (error: unknown) => error instanceof ActiveUserAuthorizationError && error.code === "USER_DISABLED");
  }
  assert.equal(repository.creates, 0);
  assert.equal(repository.idempotentCreates, 0);
  assert.equal(repository.claims, 0);
  assert.equal(repository.acks, 0);
});

test("Toy Web create returns a safe unavailable response before mutating for a disabled user", async () => {
  const repository = new FakeToyRepository();
  const service = new ToyCommandService(repository, USER_ID);
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.webUserId = USER_ID;
    next();
  });
  app.use("/api/v1/toy", createToyUserRouter({ toyService: service }));

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/toy/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      success: false,
      error: { code: "TOY_UNAVAILABLE", message: "Toy command queue is unavailable." },
    });
    assert.equal(repository.creates, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("Toy rejects a missing bound user before any mutation", async () => {
  const repository = new FakeToyRepository();
  repository.status = null;
  const service = new ToyCommandService(repository, USER_ID);
  await assert.rejects(
    service.create(USER_ID, { action: "stop" }),
    (error: unknown) => error instanceof ActiveUserAuthorizationError && error.code === "USER_NOT_FOUND",
  );
  assert.equal(repository.creates, 0);
});

test("Toy keeps active Web and MCP operations working", async () => {
  const repository = new FakeToyRepository();
  repository.status = "active";
  const service = new ToyCommandService(repository, USER_ID);
  await service.create(USER_ID, { action: "stop" });
  await service.createIdempotently(USER_ID, { action: "stop" }, "toy-active-test-0001");
  assert.equal(repository.creates, 1);
  assert.equal(repository.idempotentCreates, 1);
  assert.equal((await service.claim())?.userId, USER_ID);
  await service.ack("33333333-3333-4333-8333-333333333333", { status: "completed" });
  assert.equal(repository.claims, 1);
  assert.equal(repository.acks, 1);
});
