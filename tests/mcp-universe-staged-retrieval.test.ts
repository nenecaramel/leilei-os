import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const nodeA = {
  id: "节点 A",
  title: "A",
  type: "planet",
  tags: ["a"],
  galaxies: ["galaxy-a"],
  importance: null,
  updatedAt: new Date("2026-08-25T02:00:00.000Z"),
  summaryPreview: "A summary",
};
const nodeB = {
  id: "节点 B",
  title: "B",
  type: "planet",
  tags: ["b"],
  galaxies: ["galaxy-b"],
  importance: "major",
  updatedAt: new Date("2026-08-25T01:00:00.000Z"),
  summaryPreview: "B summary",
};
const detailNode = {
  id: nodeA.id,
  title: nodeA.title,
  summary: "A summary",
  content: `${"正文".repeat(200)}`,
  type: nodeA.type,
  tags: nodeA.tags,
  galaxies: [{ id: "galaxy-a", weight: 1 }],
  position: { x: 10, y: 20 },
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: nodeA.updatedAt.toISOString(),
};

async function connect() {
  let listCalls = 0;
  let readCalls = 0;
  const service = {
    async listUniverseNodes(_userId: string, _limit: number, after?: { updatedAt: string; id: string }) {
      listCalls += 1;
      return after
        ? { nodes: [nodeB], hasMore: false, version: 7 }
        : { nodes: [nodeA], hasMore: true, version: 7 };
    },
    async readUniverseNode(_userId: string, id: string) {
      readCalls += 1;
      return id === nodeA.id ? { node: detailNode, version: 7 } : { node: null, version: 7 };
    },
    async search() { return { results: [], metadata: { count: 0, limit: 10, has_more: false, next_cursor: null } }; },
  };
  const server = createMcpServer({
    universeTools: { universeService: service as never, getAuthenticatedUserId: () => USER_ID },
  });
  const client = new Client({ name: "universe-staged-retrieval", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, counters: () => ({ listCalls, readCalls }) };
}

test("list_universe_nodes provides bounded paginated discovery and exact detail pointers", async (t) => {
  const { client, server, counters } = await connect();
  t.after(async () => { await client.close(); await server.close(); });
  const first = await client.callTool({ name: "list_universe_nodes", arguments: { limit: 1 } });
  assert.equal(first.isError, undefined);
  const firstData = (first.structuredContent as { data: { nodes: Array<Record<string, unknown>>; next_cursor: string; has_more: boolean } }).data;
  assert.equal(firstData.has_more, true);
  assert.equal(firstData.nodes[0]!.id, nodeA.id);
  assert.equal("content" in firstData.nodes[0]!, false);
  assert.equal(firstData.nodes[0]!.detail_tool, "get_universe_node");
  assert.deepEqual(firstData.nodes[0]!.detail_arguments, { id: nodeA.id });
  assert.equal(Array.from(String(firstData.nodes[0]!.summary_preview)).length <= 240, true);

  const second = await client.callTool({ name: "list_universe_nodes", arguments: { limit: 1, cursor: firstData.next_cursor } });
  const secondData = (second.structuredContent as { data: { nodes: Array<Record<string, unknown>> } }).data;
  assert.equal(secondData.nodes[0]!.id, nodeB.id);
  assert.deepEqual(counters(), { listCalls: 2, readCalls: 0 });

  const invalid = await client.callTool({ name: "list_universe_nodes", arguments: { cursor: "not-a-cursor" } });
  assert.equal(invalid.isError, true);
  assert.deepEqual(counters(), { listCalls: 2, readCalls: 0 });
});

test("get_universe_node uses the exact node read path and preserves full detail/version", async (t) => {
  const { client, server, counters } = await connect();
  t.after(async () => { await client.close(); await server.close(); });
  const response = await client.callTool({ name: "get_universe_node", arguments: { id: nodeA.id } });
  assert.equal(response.isError, undefined);
  assert.deepEqual((response.structuredContent as { data: unknown }).data, { ...detailNode, universe_version: 7 });
  assert.deepEqual(counters(), { listCalls: 0, readCalls: 1 });
});
