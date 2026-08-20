import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryRepository } from "../src/domains/memory/memory-repository.js";
import {
  MemoryDomainError,
  MemoryService,
} from "../src/domains/memory/memory-service.js";

const USER_ID = "user-memory-delete";

function serviceWith(overrides: Partial<MemoryRepository> = {}) {
  const repository = {
    async findUserById() {
      return { displayName: "Owner", status: "active" as const };
    },
    permanentlyDeleteMemory: async () => true,
    ...overrides,
  } as MemoryRepository;
  return { service: new MemoryService(repository), repository };
}

test("MemoryService permanently deletes an archived Memory through the repository", async () => {
  const calls: Array<{ userId: string; id: string }> = [];
  const { service } = serviceWith({
    permanentlyDeleteMemory: async (input) => {
      calls.push(input);
      return true;
    },
  });

  await service.permanentlyDeleteMemory({ userId: USER_ID, id: "memory-1" });

  assert.deepEqual(calls, [{
    userId: USER_ID,
    id: "memory-1",
    actorType: "user",
    channel: "web",
  }]);
});

test("MemoryService maps an ineligible permanent delete to the existing not-found error", async () => {
  const { service } = serviceWith({
    permanentlyDeleteMemory: async () => false,
  });

  await assert.rejects(
    service.permanentlyDeleteMemory({ userId: USER_ID, id: "memory-1" }),
    (error: unknown) =>
      error instanceof MemoryDomainError && error.code === "MEMORY_NOT_FOUND",
  );
});

test("MemoryService rejects permanent deletion before repository access for a disabled user", async () => {
  let called = false;
  const { service } = serviceWith({
    async findUserById() {
      return { displayName: "Disabled", status: "disabled" as const };
    },
    permanentlyDeleteMemory: async () => {
      called = true;
      return true;
    },
  });

  await assert.rejects(
    service.permanentlyDeleteMemory({ userId: USER_ID, id: "memory-1" }),
    (error: unknown) =>
      error instanceof MemoryDomainError && error.code === "USER_DISABLED",
  );
  assert.equal(called, false);
});
