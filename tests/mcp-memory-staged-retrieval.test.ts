import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const MEMORY_ID = "memory-staged-1";
const BODY = `${"前".repeat(180)} bodyneedle ${"后".repeat(180)}`;

async function connect() {
  const service = {
    async readMemory(input: { query?: string }) {
      return {
        user: { display_name: "Leilei" },
        memories: [{
          id: MEMORY_ID,
          category: "project" as const,
          key: "keyneedle",
          content: BODY,
          tags: ["MCP"],
          source: "web",
          author: "L" as const,
          updated_at: "2026-08-25T00:00:00.000Z",
        }],
        metadata: { count: input.query ? 1 : 1 },
      };
    },
    async readMemoryDetail() {
      return {
        id: MEMORY_ID,
        category: "project" as const,
        key: "keyneedle",
        content: BODY,
        tags: ["MCP"],
        source: "web",
        author: "L" as const,
        updated_at: "2026-08-25T00:00:00.000Z",
        lifecycle_status: "active" as const,
      };
    },
  };
  const server = createMcpServer({
    memoryReads: { memoryService: service, getAuthenticatedUserId: () => USER_ID },
  });
  const client = new Client({ name: "memory-staged-retrieval", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("read_memory returns compact preview and an exact get_memory pointer", async (t) => {
  const { client, server } = await connect();
  t.after(async () => { await client.close(); await server.close(); });
  const response = await client.callTool({ name: "read_memory", arguments: {} });
  const item = (response.structuredContent as { data: { memories: Array<Record<string, unknown>> } }).data.memories[0]!;
  assert.equal("content" in item, false);
  assert.equal(item.id, MEMORY_ID);
  assert.equal(item.detail_tool, "get_memory");
  assert.deepEqual(item.detail_arguments, { id: MEMORY_ID, scope: "active" });
  assert.equal(typeof item.preview, "string");
  assert.equal(Array.from(String(item.preview)).length <= 240, true);
});

test("search_memory returns body snippets only for body matches and keeps exact detail reads full", async (t) => {
  const { client, server } = await connect();
  t.after(async () => { await client.close(); await server.close(); });
  const keyOnly = await client.callTool({ name: "search_memory", arguments: { query: "keyneedle" } });
  const keyItem = (keyOnly.structuredContent as { data: { memories: Array<Record<string, unknown>> } }).data.memories[0]!;
  assert.equal(keyItem.snippet, null);
  assert.equal("content" in keyItem, false);

  const bodyMatch = await client.callTool({ name: "search_memory", arguments: { query: "bodyneedle" } });
  const bodyItem = (bodyMatch.structuredContent as { data: { memories: Array<Record<string, unknown>> } }).data.memories[0]!;
  assert.match(String(bodyItem.snippet), /bodyneedle/);
  assert.equal(Array.from(String(bodyItem.snippet)).length <= 240, true);
  assert.equal(bodyItem.detail_tool, "get_memory");

  const detail = await client.callTool({ name: "get_memory", arguments: { id: MEMORY_ID } });
  const detailItem = (detail.structuredContent as { data: { content: string } }).data;
  assert.equal(detailItem.content, BODY);
});
