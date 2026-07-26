import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  ToyAckRepositoryResult,
  ToyCommandRepository,
} from "../src/domains/toy/toy-command-repository.js";
import {
  ToyCommandService,
  ToyDomainError,
} from "../src/domains/toy/toy-command-service.js";
import type {
  ToyAckInput,
  ToyCommandRecord,
  ToyCreateInput,
} from "../src/domains/toy/toy-command-types.js";
import type { WebApiConfig } from "../src/config/env.js";
import { mapWebPrincipalToUserId } from "../src/web-api/user-identity-mapper.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

class FakeRepository implements ToyCommandRepository {
  creates: Array<{ userId: string; input: ToyCreateInput }> = [];
  claimUserIds: string[] = [];
  ackCalls: Array<{ userId: string; id: string; input: ToyAckInput }> = [];
  ackResult: ToyAckRepositoryResult = { kind: "not_found" };

  async create(userId: string, input: ToyCreateInput) {
    this.creates.push({ userId, input });
    return record({ userId, action: input.action, percent: input.action === "set" ? input.percent : null });
  }
  async claim(userId: string) {
    this.claimUserIds.push(userId);
    return null;
  }
  async ack(userId: string, id: string, input: ToyAckInput) {
    this.ackCalls.push({ userId, id, input });
    return this.ackResult;
  }
}

test("creates only strict high-level set and stop commands for the bound user", async () => {
  const repository = new FakeRepository();
  const service = new ToyCommandService(repository, USER_ID);
  await service.create(USER_ID, { action: "set", percent: 1 });
  await service.create(USER_ID, { action: "set", percent: 40 });
  await service.create(USER_ID, { action: "stop" });
  assert.deepEqual(repository.creates.map(({ input }) => input), [
    { action: "set", percent: 1 },
    { action: "set", percent: 40 },
    { action: "stop" },
  ]);
});

test("rejects invalid intensity, coercion, stop percent and arbitrary payload fields", async () => {
  const service = new ToyCommandService(new FakeRepository(), USER_ID);
  const invalid = [
    { action: "set", percent: 0 },
    { action: "set", percent: -1 },
    { action: "set", percent: 41 },
    { action: "set", percent: 1.5 },
    { action: "set", percent: Number.NaN },
    { action: "set", percent: Number.POSITIVE_INFINITY },
    { action: "set", percent: Number.NEGATIVE_INFINITY },
    { action: "set", percent: "20" },
    { action: "set", percent: true },
    { action: "set", percent: null },
    { action: "stop", percent: 1 },
    { action: "set" },
    {},
    [],
    { action: "set", percent: 20, bytes: [1, 2] },
    { action: "stop", url: "http://127.0.0.1:8765" },
    { action: "stop", shell: "echo unsafe" },
    { action: "stop", expires_at: "2099-01-01T00:00:00Z" },
    { action: "stop", createdAt: "2026-07-26T10:00:00Z" },
    { action: "stop", userId: USER_ID },
    { action: "stop", payload: "unsafe" },
    { action: "stop", hex: "ff" },
    { action: "stop", command: "unsafe" },
  ];
  for (const input of invalid) {
    await assert.rejects(
      service.create(USER_ID, input),
      (error: unknown) => error instanceof ToyDomainError && error.code === "INVALID_INPUT",
    );
  }
});

test("uses the database UUID produced by the existing Auth0 subject mapping", async () => {
  const config = {
    MCP_USER_ID: USER_ID,
    AUTH0_ISSUER: "https://tenant.example.com/",
    AUTH0_JWKS_URI: "https://tenant.example.com/.well-known/jwks.json",
    AUTH0_ALLOWED_SUBJECT: "auth0|leilei",
    WEB_APP_ORIGIN: "https://web.example.com",
    WEB_AUTH0_AUDIENCE: "https://api.example.com",
    WEB_AUTH0_REQUIRED_SCOPE: "leilei:web",
  } satisfies WebApiConfig;
  const mappedUserId = mapWebPrincipalToUserId(config, {
    subject: config.AUTH0_ALLOWED_SUBJECT,
    issuer: config.AUTH0_ISSUER,
    audience: [config.WEB_AUTH0_AUDIENCE],
    scopes: [config.WEB_AUTH0_REQUIRED_SCOPE],
  });
  const repository = new FakeRepository();
  await new ToyCommandService(repository, USER_ID).create(
    mappedUserId,
    { action: "stop" },
  );
  assert.equal(mappedUserId, USER_ID);
  assert.equal(repository.creates[0]?.userId, USER_ID);
  assert.notEqual(mappedUserId, config.AUTH0_ALLOWED_SUBJECT);
});

test("fails closed for missing config and forbids non-bound Web users", async () => {
  await assert.rejects(
    new ToyCommandService(new FakeRepository(), undefined).create(USER_ID, { action: "stop" }),
    (error: unknown) => error instanceof ToyDomainError && error.code === "TOY_UNAVAILABLE",
  );
  await assert.rejects(
    new ToyCommandService(new FakeRepository(), USER_ID).create(
      "22222222-2222-4222-8222-222222222222",
      { action: "stop" },
    ),
    (error: unknown) => error instanceof ToyDomainError && error.code === "TOY_FORBIDDEN",
  );
});

test("bridge claim and ack never accept a user id and enforce ack schemas", async () => {
  const repository = new FakeRepository();
  const service = new ToyCommandService(repository, USER_ID);
  await service.claim();
  assert.deepEqual(repository.claimUserIds, [USER_ID]);

  const id = randomUUID();
  repository.ackResult = { kind: "updated", command: record({ id, userId: USER_ID, status: "completed" }) };
  await service.ack(id, { status: "completed" });
  assert.equal(repository.ackCalls[0]?.userId, USER_ID);
  repository.ackResult = {
    kind: "updated",
    command: record({ id, userId: USER_ID, status: "failed", error: "safe failure" }),
  };
  await service.ack(id, { status: "failed", error: "  safe failure  " });
  assert.deepEqual(repository.ackCalls[1]?.input, {
    status: "failed",
    error: "safe failure",
  });

  for (const input of [
    { status: "completed", error: "not allowed" },
    { status: "failed", error: "" },
    { status: "failed", error: "x".repeat(501) },
    { status: "pending" },
    { status: "failed", error: "safe", script: "unsafe" },
  ]) {
    await assert.rejects(
      service.ack(id, input),
      (error: unknown) => error instanceof ToyDomainError && error.code === "INVALID_INPUT",
    );
  }
});

test("maps repository not-found and terminal conflicts to safe domain errors", async () => {
  const repository = new FakeRepository();
  const service = new ToyCommandService(repository, USER_ID);
  const id = randomUUID();
  for (const [result, code] of [
    [{ kind: "not_found" }, "COMMAND_NOT_FOUND"],
    [{ kind: "expired" }, "COMMAND_CONFLICT"],
    [{ kind: "conflict" }, "COMMAND_CONFLICT"],
  ] as const) {
    repository.ackResult = result;
    await assert.rejects(
      service.ack(id, { status: "completed" }),
      (error: unknown) => error instanceof ToyDomainError && error.code === code,
    );
  }
});

function record(overrides: Partial<ToyCommandRecord> = {}): ToyCommandRecord {
  return {
    id: randomUUID(),
    userId: USER_ID,
    action: "stop",
    percent: null,
    status: "pending",
    createdAt: new Date("2026-07-26T10:00:00Z"),
    expiresAt: new Date("2026-07-26T10:00:10Z"),
    claimedAt: null,
    completedAt: null,
    expiredAt: null,
    error: null,
    ...overrides,
  };
}
