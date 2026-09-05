import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import type { CreateMcpMemoryResult } from "../src/domains/memory/memory-service.js";

const userId = "00000000-0000-4000-8000-000000000099";
const result: CreateMcpMemoryResult = {
  memory: { id: "00000000-0000-4000-8000-000000000101", category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6"], source: "mcp", lifecycle_status: "active", created_at: "2026-08-01T08:00:00.000Z", updated_at: "2026-08-01T08:00:00.000Z", author: "L" },
  metadata: { created: true, idempotent_replay: false },
};

const cResult: CreateMcpMemoryResult = {
  ...result,
  memory: { ...result.memory, author: "C" },
};

async function fixture(memoryResult: CreateMcpMemoryResult = result) {
  const calls: unknown[] = [];
  const updateCalls: unknown[] = [];
  let authenticationCalls = 0;
  const server = createMcpServer({
    readMemory: { memoryService: { readMemory: async () => ({ user: { display_name: "Leilei" }, memories: [], metadata: { count: 0 } }) }, getAuthenticatedUserId: () => userId },
    writeMemory: { memoryService: { async createMcpMemory(context, input, key) { calls.push({ context, input, key }); return memoryResult; } }, getAuthenticatedUserId: () => { authenticationCalls += 1; return userId; } },
    updateMemory: { memoryService: { async updateMcpMemory(context, input) { updateCalls.push({ context, input }); return { id: "00000000-0000-4000-8000-000000000102", category: "goal", key: "ship", content: "Updated safely", tags: [], source: "mcp", updated_at: "2026-08-01T08:00:00.000Z", author: "C" }; } }, getAuthenticatedUserId: () => userId },
  });
  const client = new Client({ name: "write-memory-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls, updateCalls, authenticationCalls: () => authenticationCalls };
}

test("write_memory and update_memory preserve explicit C authors in structured responses", async (t) => {
  const { client, server, calls, updateCalls } = await fixture(cResult);
  t.after(async () => { await client.close(); await server.close(); });
  const tools = await client.listTools();
  const tool = tools.tools.find((candidate) => candidate.name === "write_memory");
  assert.ok(tool);
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  for (const forbidden of ["userId", "user_id", "source", "status", "visibility", "created_at", "updated_at"]) {
    assert.equal(forbidden in (tool.inputSchema.properties ?? {}), false);
  }
  assert.match(tool.description ?? "", /explicitly approves/);
  assert.match(tool.description ?? "", /get_memory/);

  const response = await client.callTool({ name: "write_memory", arguments: { category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6"], author: "C", idempotency_key: "memory-request-0001" } });
  assert.equal(response.isError, undefined);
  assert.deepEqual(calls, [{ context: { userId }, input: { category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6"], author: "C" }, key: "memory-request-0001" }]);
  assert.deepEqual(response.structuredContent, {
    success: true,
    data: {
      memory: {
        id: cResult.memory.id,
        category: cResult.memory.category,
        key: cResult.memory.key,
        tags: cResult.memory.tags,
        source: cResult.memory.source,
        lifecycle_status: cResult.memory.lifecycle_status,
        created_at: cResult.memory.created_at,
        updated_at: cResult.memory.updated_at,
        author: "C",
      },
      metadata: cResult.metadata,
      detail_tool: "get_memory",
      detail_arguments: { id: cResult.memory.id, scope: "active" },
    },
  });

  const updateResponse = await client.callTool({ name: "update_memory", arguments: { id: "00000000-0000-4000-8000-000000000102", content: "Updated safely", author: "C" } });
  assert.equal(updateResponse.isError, undefined);
  assert.deepEqual(updateCalls, [{ context: { userId }, input: { id: "00000000-0000-4000-8000-000000000102", content: "Updated safely", author: "C" } }]);
  assert.equal((updateResponse.structuredContent as { data: { author: string } }).data.author, "C");
});

test("write_memory rejects identity injection and invalid values before service", async (t) => {
  const { client, server, calls, authenticationCalls } = await fixture();
  t.after(async () => { await client.close(); await server.close(); });
  for (const argumentsValue of [
    { category: "goal", key: "ship", content: "Ship safely", author: "L", idempotency_key: "memory-request-0002", user_id: userId },
    { category: "goal", key: "ship", content: "Ship safely", author: "L", idempotency_key: "memory-request-0002b", userId },
    { category: "other", key: "ship", content: "Ship safely", author: "L", idempotency_key: "memory-request-0003" },
    { category: "goal", key: "ship", content: "Ship safely", author: "L", tags: Array.from({ length: 21 }, () => "x"), idempotency_key: "memory-request-0004" },
    { category: "goal", key: "ship", content: "Ship safely", author: "Claude", idempotency_key: "memory-request-0005" },
  ]) {
    const response = await client.callTool({ name: "write_memory", arguments: argumentsValue });
    assert.equal(response.isError, true);
  }
  assert.equal(calls.length, 0);
  assert.equal(authenticationCalls(), 0);
});

test("write_memory response distinguishes creation, active replay, and archived replay", async (t) => {
  const cases = [
    { value: result, includes: /created successfully.*get_memory/i, excludes: /archived/i },
    { value: { ...result, metadata: { created: false, idempotent_replay: true } }, includes: /active Memory.*get_memory/i, excludes: /archived/i },
    { value: { ...result, memory: { ...result.memory, lifecycle_status: "archived" as const }, metadata: { created: false, idempotent_replay: true } }, includes: /archived.*no duplicate.*Do not call.*get_memory/i, excludes: /Call get_memory with the returned id/i },
  ];
  for (const [index, item] of cases.entries()) {
    const { client, server } = await fixture(item.value);
    t.after(async () => { await client.close(); await server.close(); });
    const response = await client.callTool({ name: "write_memory", arguments: { category: "goal", key: "ship", content: "Ship safely", author: "L", idempotency_key: `memory-response-000${index}` } });
    const text = String(response.content[0] && "text" in response.content[0] ? response.content[0].text : "");
    assert.match(text, item.includes);
    assert.doesNotMatch(text, item.excludes);
  }
});

test("write_memory schema defers normalized length boundaries to MemoryService", async (t) => {
  const { client, server, calls } = await fixture();
  t.after(async () => { await client.close(); await server.close(); });
  const response = await client.callTool({ name: "write_memory", arguments: {
    category: "goal",
    key: ` ${"k".repeat(100)} `,
    content: ` ${"c".repeat(4_000)} `,
    tags: [` ${"e\u0301".repeat(50)} `],
    author: "G",
    idempotency_key: "memory-boundary-0001",
  } });
  assert.equal(response.isError, undefined);
  assert.equal(calls.length, 1);
});
