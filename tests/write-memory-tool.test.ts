import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import type { CreateMcpMemoryResult } from "../src/domains/memory/memory-service.js";

const userId = "00000000-0000-4000-8000-000000000099";
const result: CreateMcpMemoryResult = {
  memory: { id: "00000000-0000-4000-8000-000000000101", category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6"], source: "mcp", lifecycle_status: "active", created_at: "2026-08-01T08:00:00.000Z", updated_at: "2026-08-01T08:00:00.000Z" },
  metadata: { created: true, idempotent_replay: false },
};

async function fixture() {
  const calls: unknown[] = [];
  const server = createMcpServer({
    readMemory: { memoryService: { readMemory: async () => ({ user: { display_name: "Leilei" }, memories: [], metadata: { count: 0 } }) }, getAuthenticatedUserId: () => userId },
    writeMemory: { memoryService: { async createMcpMemory(context, input, key) { calls.push({ context, input, key }); return result; } }, getAuthenticatedUserId: () => userId },
  });
  const client = new Client({ name: "write-memory-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls };
}

test("write_memory exposes the confirmed idempotent server-owned contract", async (t) => {
  const { client, server, calls } = await fixture();
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

  const response = await client.callTool({ name: "write_memory", arguments: { category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6"], idempotency_key: "memory-request-0001" } });
  assert.equal(response.isError, undefined);
  assert.deepEqual(calls, [{ context: { userId }, input: { category: "goal", key: "ship", content: "Ship safely", tags: ["Phase 6"] }, key: "memory-request-0001" }]);
  assert.deepEqual(response.structuredContent, { success: true, data: result });
});

test("write_memory rejects identity injection and invalid values before service", async (t) => {
  const { client, server, calls } = await fixture();
  t.after(async () => { await client.close(); await server.close(); });
  for (const argumentsValue of [
    { category: "goal", key: "ship", content: "Ship safely", idempotency_key: "memory-request-0002", user_id: userId },
    { category: "other", key: "ship", content: "Ship safely", idempotency_key: "memory-request-0003" },
    { category: "goal", key: "ship", content: "Ship safely", tags: Array.from({ length: 21 }, () => "x"), idempotency_key: "memory-request-0004" },
  ]) {
    const response = await client.callTool({ name: "write_memory", arguments: argumentsValue });
    assert.equal(response.isError, true);
  }
  assert.equal(calls.length, 0);
});
