import assert from "node:assert/strict";
import test from "node:test";
import type {
  MemoryRepository,
} from "../src/domains/memory/memory-repository.js";
import {
  MemoryDomainError,
  MemoryService,
} from "../src/domains/memory/memory-service.js";

function repository(
  overrides: Partial<MemoryRepository> = {},
): MemoryRepository {
  return {
    async findUserById() {
      return { displayName: "Leilei", status: "active" };
    },
    async findActiveAssistantMemories() {
      return [];
    },
    async findActiveAssistantMemoryById() {
      return {
        id: "memory-1",
        category: "preference",
        key: "focus_style",
        content: "One milestone at a time.",
        updatedAt: new Date("2026-07-28T00:00:00.000Z"),
      };
    },
    async createMemory() {},
    async updateMemory() {},
    async archiveMemory() {},
    ...overrides,
  };
}

test("Memory detail uses the authenticated user for an active assistant-visible record", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemoryById(input) {
      calls.push(input);
      return {
        id: input.id,
        category: "preference",
        key: "focus_style",
        content: "One milestone at a time.",
        updatedAt: new Date("2026-07-28T00:00:00.000Z"),
      };
    },
  }));

  const result = await service.readMemoryDetail({
    userId: "user-a",
    id: " memory-1 ",
  });

  assert.deepEqual(calls, [{ userId: "user-a", id: "memory-1" }]);
  assert.equal(result.id, "memory-1");
  assert.equal(result.content, "One milestone at a time.");
});

test("Memory detail cannot return a record outside the authenticated user scope", async () => {
  const service = new MemoryService(repository({
    async findActiveAssistantMemoryById(input) {
      assert.equal(input.userId, "user-a");
      return null;
    },
  }));

  await assert.rejects(
    service.readMemoryDetail({
      userId: "user-a",
      id: "owned-by-user-b",
    }),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "MEMORY_NOT_FOUND",
  );
});

test("Memory detail checks active user status before querying the record", async () => {
  let queried = false;
  const service = new MemoryService(repository({
    async findUserById() {
      return { displayName: "Leilei", status: "disabled" };
    },
    async findActiveAssistantMemoryById() {
      queried = true;
      return null;
    },
  }));

  await assert.rejects(
    service.readMemoryDetail({
      userId: "user-a",
      id: "memory-1",
    }),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "USER_DISABLED",
  );
  assert.equal(queried, false);
});
