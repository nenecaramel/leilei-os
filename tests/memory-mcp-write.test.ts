import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryRepository, McpMemoryCreateResult } from "../src/domains/memory/memory-repository.js";
import { MemoryDomainError, MemoryService } from "../src/domains/memory/memory-service.js";
import { hashMcpWriteRequest } from "../src/domains/mcp-write/mcp-write-idempotency.js";

const now = new Date("2026-08-01T08:00:00.000Z");
const record = {
  id: "00000000-0000-4000-8000-000000000101",
  category: "goal" as const,
  key: "ship",
  content: "Ship safely",
  tags: ["Phase 6"],
  source: "mcp" as const,
  status: "active" as const,
  createdAt: now,
  updatedAt: now,
};

function repository(overrides: Partial<MemoryRepository> = {}): MemoryRepository {
  return {
    async findUserById() { return { displayName: "Leilei", status: "active" }; },
    async findActiveAssistantMemories() { return []; },
    async findActiveAssistantMemoryCategories() { return []; },
    async findActiveAssistantMemoryTags() { return []; },
    async findActiveAssistantMemoryById() { return null; },
    async findArchivedAssistantMemories() { return []; },
    async findArchivedAssistantMemoryById() { return null; },
    async createMemory() {},
    async createMemoryIdempotently() { return { outcome: "created", memory: record }; },
    async updateMemory() { return true; },
    async archiveMemory() { return true; },
    async restoreMemory() { return true; },
    ...overrides,
  };
}

test("MCP Memory normalizes input and persists the authoritative trusted shape", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({
    async createMemoryIdempotently(input) {
      calls.push(input);
      return { outcome: "created", memory: { ...record, key: input.key, content: input.content, tags: input.tags } };
    },
  }));
  const result = await service.createMcpMemory(
    { userId: "user-a" },
    { category: "goal", key: "  s\u0068ip  ", content: "  Ship safely  ", tags: [" Phase 6 ", "Phase 6", "Cafe\u0301"] },
    "  memory-request-0001  ",
  );
  assert.deepEqual(calls, [{
    userId: "user-a", category: "goal", key: "ship", content: "Ship safely",
    tags: ["Phase 6", "Caf\u00e9"], source: "mcp", idempotencyKey: "memory-request-0001",
    requestHash: hashMcpWriteRequest({ category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6", "Caf\u00e9"] }),
  }]);
  assert.equal(result.memory.source, "mcp");
  assert.deepEqual(result.metadata, { created: true, idempotent_replay: false });
});

test("MCP Memory reports replay and safe durable conflicts", async () => {
  for (const [outcome, code] of [["conflict", "IDEMPOTENCY_CONFLICT"], ["key_conflict", "MEMORY_KEY_CONFLICT"]] as const) {
    const service = new MemoryService(repository({
      async createMemoryIdempotently(): Promise<McpMemoryCreateResult> { return { outcome }; },
    }));
    await assert.rejects(
      service.createMcpMemory({ userId: "user-a" }, { category: "goal", key: "ship", content: "Ship safely" }, "memory-request-0002"),
      (error) => error instanceof MemoryDomainError && error.code === code,
    );
  }
  const service = new MemoryService(repository({
    async createMemoryIdempotently() { return { outcome: "replayed", memory: { ...record, status: "archived" } }; },
  }));
  const replay = await service.createMcpMemory({ userId: "user-a" }, { category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6"] }, "memory-request-0003");
  assert.equal(replay.memory.lifecycle_status, "archived");
  assert.deepEqual(replay.metadata, { created: false, idempotent_replay: true });
});

test("invalid MCP Memory input and inactive users fail before persistence", async () => {
  const invalid = [
    { input: { category: "goal" as const, key: " ", content: "content" }, key: "memory-request-0004", code: "INVALID_MEMORY_KEY" },
    { input: { category: "goal" as const, key: "key", content: " " }, key: "memory-request-0005", code: "INVALID_MEMORY_CONTENT" },
    { input: { category: "goal" as const, key: "key", content: "content", tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, key: "memory-request-0006", code: "INVALID_MEMORY_TAGS" },
    { input: { category: "goal" as const, key: "key", content: "content" }, key: "short", code: "INVALID_IDEMPOTENCY_KEY" },
  ];
  for (const item of invalid) {
    let persisted = false;
    const service = new MemoryService(repository({ async createMemoryIdempotently() { persisted = true; return { outcome: "created", memory: record }; } }));
    await assert.rejects(service.createMcpMemory({ userId: "user-a" }, item.input, item.key), (error) => error instanceof MemoryDomainError && error.code === item.code);
    assert.equal(persisted, false);
  }
  for (const state of ["missing", "disabled"] as const) {
    let persisted = false;
    const service = new MemoryService(repository({
      async findUserById() { return state === "missing" ? null : { displayName: "Leilei", status: "disabled" }; },
      async createMemoryIdempotently() { persisted = true; return { outcome: "created", memory: record }; },
    }));
    await assert.rejects(service.createMcpMemory({ userId: "user-a" }, { category: "goal", key: "key", content: "content" }, "memory-request-0007"), (error) => error instanceof MemoryDomainError && error.code === (state === "missing" ? "USER_NOT_FOUND" : "USER_DISABLED"));
    assert.equal(persisted, false);
  }
});

test("Web Memory creation remains source web", async () => {
  const calls: unknown[] = [];
  const service = new MemoryService(repository({ async createMemory(input) { calls.push(input); } }));
  await service.createMemory({ userId: "user-a", category: "profile", key: "name", content: "Leilei", tags: [] });
  assert.equal((calls[0] as { source: string }).source, "web");
});
