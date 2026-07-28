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
    async findActiveAssistantMemoryCategories() {
      return [];
    },
    async findActiveAssistantMemoryTags() {
      return [];
    },
    async findActiveAssistantMemoryById() {
      return {
        id: "memory-1",
        category: "preference",
        key: "focus_style",
        content: "One milestone at a time.",
        tags: [],
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
        tags: ["focus"],
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

test("Memory search and category filters are normalized and combined for the authenticated user", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemories(input) {
      calls.push(input);
      return [];
    },
  }));

  await service.readMemory({
    userId: "user-a",
    query: "  focused plan  ",
    categories: ["goal"],
    tag: " focus ",
  });

  assert.deepEqual(calls, [{
    userId: "user-a",
    query: "focused plan",
    categories: ["goal"],
    keys: undefined,
    tag: "focus",
    limit: 50,
  }]);
});

test("Memory supports search-only and exact-category-only repository queries", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemories(input) {
      calls.push(input);
      return [];
    },
  }));

  await service.readMemory({
    userId: "user-a",
    query: "literal %_\\ text",
  });
  await service.readMemory({
    userId: "user-a",
    categories: ["project"],
  });

  assert.deepEqual(calls, [
    {
      userId: "user-a",
      query: "literal %_\\ text",
      categories: undefined,
      keys: undefined,
      tag: undefined,
      limit: 50,
    },
    {
      userId: "user-a",
      query: undefined,
      categories: ["project"],
      keys: undefined,
      tag: undefined,
      limit: 50,
    },
  ]);
});

test("Memory category options use only the authenticated active user's repository scope", async () => {
  const users: string[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemoryCategories(userId) {
      users.push(userId);
      return ["goal", "project"];
    },
  }));

  assert.deepEqual(
    await service.listAvailableCategories("user-a"),
    ["goal", "project"],
  );
  assert.deepEqual(users, ["user-a"]);
});

test("Memory category options reject a disabled user before querying visible categories", async () => {
  let queried = false;
  const service = new MemoryService(repository({
    async findUserById() {
      return { displayName: "Leilei", status: "disabled" };
    },
    async findActiveAssistantMemoryCategories() {
      queried = true;
      return [];
    },
  }));

  await assert.rejects(
    service.listAvailableCategories("user-a"),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "USER_DISABLED",
  );
  assert.equal(queried, false);
});

test("Memory creates and edits normalized tags using the shared tag rules", async () => {
  const writes: unknown[] = [];
  const service = new MemoryService(repository({
    async createMemory(input) {
      writes.push({ create: input });
    },
    async updateMemory(input) {
      writes.push({ update: input });
    },
  }));

  await service.createMemory({
    userId: "user-a",
    category: "goal",
    key: "tagged_memory",
    content: "Tagged content",
    tags: [" 计划 ", "MCP", "计划"],
  });
  await service.updateMemory({
    userId: "user-a",
    id: "memory-1",
    content: "Updated",
    tags: ["MCP", "完成"],
  });

  assert.deepEqual(writes, [
    {
      create: {
        userId: "user-a",
        category: "goal",
        key: "tagged_memory",
        content: "Tagged content",
        tags: ["计划", "MCP"],
        source: "web",
      },
    },
    {
      update: {
        userId: "user-a",
        id: "memory-1",
        content: "Updated",
        tags: ["MCP", "完成"],
      },
    },
  ]);
});

test("Memory tag validation rejects blank, oversized, and excessive tags", async () => {
  const service = new MemoryService(repository());
  for (const tags of [
    ["   "],
    ["x".repeat(51)],
    Array.from({ length: 21 }, (_, index) => `tag-${index}`),
  ]) {
    await assert.rejects(
      service.createMemory({
        userId: "user-a",
        category: "goal",
        key: "tagged_memory",
        content: "Tagged content",
        tags,
      }),
      (error) =>
        error instanceof MemoryDomainError &&
        error.code === "INVALID_MEMORY_TAGS",
    );
  }
});

test("Memory tag options use only the authenticated active user's repository scope", async () => {
  const users: string[] = [];
  const service = new MemoryService(repository({
    async findActiveAssistantMemoryTags(userId) {
      users.push(userId);
      return ["MCP", "计划"];
    },
  }));

  assert.deepEqual(
    await service.listAvailableTags("user-a"),
    ["MCP", "计划"],
  );
  assert.deepEqual(users, ["user-a"]);
});

test("Memory search rejects oversized input before querying records", async () => {
  let queried = false;
  const service = new MemoryService(repository({
    async findActiveAssistantMemories() {
      queried = true;
      return [];
    },
  }));

  await assert.rejects(
    service.readMemory({
      userId: "user-a",
      query: "x".repeat(201),
    }),
    (error) =>
      error instanceof MemoryDomainError &&
      error.code === "INVALID_MEMORY_QUERY",
  );
  assert.equal(queried, false);
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
