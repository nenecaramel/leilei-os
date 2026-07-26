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
    { action: "set", percent: 41 },
    { action: "set", percent: 1.5 },
    { action: "set", percent: "20" },
    { action: "set", percent: null },
    { action: "stop", percent: 1 },
    { action: "set", percent: 20, bytes: [1, 2] },
    { action: "stop", url: "http://127.0.0.1:8765" },
    { action: "stop", shell: "echo unsafe" },
    { action: "stop", expires_at: "2099-01-01T00:00:00Z" },
  ];
  for (const input of invalid) {
    await assert.rejects(
      service.create(USER_ID, input),
      (error: unknown) => error instanceof ToyDomainError && error.code === "INVALID_INPUT",
    );
  }
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
