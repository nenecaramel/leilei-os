import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { UniverseServiceError } from "../src/domains/universe/universe-service.js";

async function connect(dependencies: Record<string, unknown> = {}) {
  const server = createMcpServer(dependencies as never);
  const client = new Client({ name: "mcp-universe-write-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

const node = {
  id: "node-generated",
  title: "Node",
  summary: "Summary",
  content: "Content",
  type: "concept",
  tags: [],
  galaxies: [],
  position: { x: 0, y: 100 },
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};
const relation = {
  id: "edge-generated",
  source: "node-a",
  target: "node-b",
  relationType: "supports" as const,
  strength: 1,
  createdAt: "2026-08-21T00:00:00.000Z",
};

test("registers the three MCP Universe write tools with frozen annotations", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tools = (await fixture.client.listTools()).tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(
    ["create_universe_node", "update_universe_node", "create_universe_relation"]
      .map((name) => byName.has(name)),
    [true, true, true],
  );
  assert.deepEqual(byName.get("create_universe_node")?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(byName.get("update_universe_node")?.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  });
  assert.deepEqual(byName.get("create_universe_relation")?.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
});

test("exposes the strict create Universe node request fields", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tool = (await fixture.client.listTools()).tools.find((candidate) => candidate.name === "create_universe_node");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, [
    "title",
    "summary",
    "content",
    "type",
    "tags",
    "galaxies",
    "position",
    "expected_version",
    "idempotency_key",
  ]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
    "content",
    "expected_version",
    "galaxies",
    "idempotency_key",
    "position",
    "summary",
    "tags",
    "title",
    "type",
  ]);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test("exposes only the partial update Universe node fields", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tool = (await fixture.client.listTools()).tools.find((candidate) => candidate.name === "update_universe_node");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["id", "expected_version"]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
    "content",
    "expected_version",
    "galaxies",
    "id",
    "position",
    "summary",
    "tags",
    "title",
    "type",
  ]);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test("exposes the strict create Universe relation request fields", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tool = (await fixture.client.listTools()).tools.find((candidate) => candidate.name === "create_universe_relation");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, [
    "source",
    "target",
    "relation_type",
    "strength",
    "expected_version",
    "idempotency_key",
  ]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
    "expected_version",
    "idempotency_key",
    "relation_type",
    "source",
    "strength",
    "target",
  ]);
  assert.equal(tool.inputSchema.additionalProperties, false);
});

test("create Universe node forwards boundary positions and never accepts caller identity fields", async (t) => {
  const calls: unknown[] = [];
  const fixture = await connect({
    universeWriteTools: {
      nodeService: {
        async createMcpNode(...args: unknown[]) {
          calls.push(args);
          return { node, universe_version: 1, metadata: { created: true, idempotent_replay: false } };
        },
        async updateMcpNode() { throw new Error("not used"); },
      },
      relationService: { async createMcpRelation() { throw new Error("not used"); } },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({
    name: "create_universe_node",
    arguments: {
      title: "Node", summary: "Summary", content: "Content", type: "concept", tags: [], galaxies: [],
      position: { x: 0, y: 100 }, expected_version: 0, idempotency_key: "node-create-0000001",
    },
  });
  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as unknown[]).slice(1), [
    { title: "Node", summary: "Summary", content: "Content", type: "concept", tags: [], galaxies: [], position: { x: 0, y: 100 } },
    0,
    "node-create-0000001",
  ]);

  for (const arguments_ of [
    { title: "Node", summary: "Summary", content: "Content", type: "concept", tags: [], galaxies: [], position: { x: -1, y: 10 }, expected_version: 0, idempotency_key: "node-create-0000002" },
    { title: "Node", summary: "Summary", content: "Content", type: "concept", tags: [], galaxies: [], position: { x: 10, y: 101 }, expected_version: 0, idempotency_key: "node-create-0000003" },
    { title: "Node", summary: "Summary", content: "Content", type: "concept", tags: [], galaxies: [], position: { x: 10, y: 10 }, expected_version: 0, idempotency_key: "node-create-0000004", id: "caller-id" },
  ]) {
    const invalid = await fixture.client.callTool({ name: "create_universe_node", arguments: arguments_ });
    assert.equal(invalid.isError, true);
  }
  assert.equal(calls.length, 1);
});

test("update Universe node is a partial patch and rejects an empty or hidden patch", async (t) => {
  const calls: unknown[] = [];
  const fixture = await connect({
    universeWriteTools: {
      nodeService: {
        async createMcpNode() { throw new Error("not used"); },
        async updateMcpNode(...args: unknown[]) { calls.push(args); return { snapshot: { nodes: [node] }, version: 2 }; },
      },
      relationService: { async createMcpRelation() { throw new Error("not used"); } },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({ name: "update_universe_node", arguments: { id: "node-generated", expected_version: 1, tags: [], galaxies: [], summary: "" } });
  assert.equal(result.isError, undefined);
  assert.deepEqual((calls[0] as unknown[]).slice(1), ["node-generated", { summary: "", tags: [], galaxies: [] }, 1]);
  for (const arguments_ of [
    { id: "node-generated", expected_version: 1 },
    { id: "node-generated", expected_version: 1, importance: "anchor" },
    { id: "node-generated", expected_version: 1, createdAt: "2026-08-21T00:00:00.000Z" },
  ]) {
    const invalid = await fixture.client.callTool({ name: "update_universe_node", arguments: arguments_ });
    assert.equal(invalid.isError, true);
  }
  assert.equal(calls.length, 1);
});

test("create Universe relation enforces self-link and strength boundaries before service mutation", async (t) => {
  const calls: unknown[] = [];
  const fixture = await connect({
    universeWriteTools: {
      nodeService: { async createMcpNode() { throw new Error("not used"); }, async updateMcpNode() { throw new Error("not used"); } },
      relationService: {
        async createMcpRelation(...args: unknown[]) { calls.push(args); return { relation, universe_version: 3, metadata: { created: true, idempotent_replay: false } }; },
      },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({ name: "create_universe_relation", arguments: { source: "node-a", target: "node-b", relation_type: "supports", strength: 1, expected_version: 2, idempotency_key: "relation-create-0001" } });
  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
  const self = await fixture.client.callTool({ name: "create_universe_relation", arguments: { source: "node-a", target: "node-a", relation_type: "supports", strength: 0, expected_version: 2, idempotency_key: "relation-create-0002" } });
  assert.equal(self.isError, true);
  const invalidStrength = await fixture.client.callTool({ name: "create_universe_relation", arguments: { source: "node-a", target: "node-b", relation_type: "supports", strength: 1.1, expected_version: 2, idempotency_key: "relation-create-0003" } });
  assert.equal(invalidStrength.isError, true);
  assert.equal(calls.length, 1);
});

test("Universe mutation errors remain safe and distinguish stale versions", async (t) => {
  const fixture = await connect({
    universeWriteTools: {
      nodeService: {
        async createMcpNode() { throw new UniverseServiceError("VERSION_CONFLICT"); },
        async updateMcpNode() { throw new UniverseServiceError("NODE_NOT_FOUND"); },
      },
      relationService: { async createMcpRelation() { throw new UniverseServiceError("RELATION_CONFLICT"); } },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const stale = await fixture.client.callTool({ name: "create_universe_node", arguments: { title: "Node", summary: "", content: "", type: "concept", tags: [], galaxies: [], position: { x: 1, y: 1 }, expected_version: 3, idempotency_key: "node-error-0000001" } });
  assert.equal(stale.isError, true);
  assert.match(JSON.stringify(stale), /expected_version|fresh-read/i);
});
