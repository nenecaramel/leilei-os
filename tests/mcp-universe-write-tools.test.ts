import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { UniverseServiceError } from "../src/domains/universe/universe-service.js";
import { UniverseAuthenticationError } from "../src/mcp/tools/universe/shared.js";

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

test("registers the four MCP Universe write tools with frozen annotations", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tools = (await fixture.client.listTools()).tools;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(
    ["create_universe_node", "update_universe_node", "create_universe_relation", "update_universe_relation"]
      .map((name) => byName.has(name)),
    [true, true, true, true],
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
  assert.deepEqual(byName.get("update_universe_relation")?.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  });
  for (const name of ["create_universe_node", "update_universe_node", "create_universe_relation", "update_universe_relation"]) {
    const outputSchema = JSON.stringify(byName.get(name)?.outputSchema);
    assert.match(outputSchema, /success/);
    assert.match(outputSchema, /data/);
    assert.match(outputSchema, /error/);
    assert.match(outputSchema, /VERSION_CONFLICT/);
  }
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

test("exposes the strict partial update Universe relation request fields", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tool = (await fixture.client.listTools()).tools.find((candidate) => candidate.name === "update_universe_relation");
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ["relation_id", "expected_version"]);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
    "expected_version",
    "relation_id",
    "relation_type",
    "strength",
  ]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  });
});

test("update Universe relation forwards an explicit partial patch and returns the compact relation", async (t) => {
  const calls: unknown[] = [];
  const updatedRelation = { ...relation, relationType: "extends" as const, strength: 0.25 };
  const fixture = await connect({
    universeWriteTools: {
      nodeService: {
        async createMcpNode() { throw new Error("not used"); },
        async updateMcpNode() { throw new Error("not used"); },
      },
      relationService: {
        async createMcpRelation() { throw new Error("not used"); },
        async updateMcpRelation(...args: unknown[]) {
          calls.push(args);
          return { relation: updatedRelation, universe_version: 5 };
        },
      },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({
    name: "update_universe_relation",
    arguments: { relation_id: relation.id, expected_version: 4, relation_type: "extends", strength: 0.25 },
  });
  assert.equal(result.isError, undefined);
  assert.deepEqual(result, {
    content: [{ type: "text", text: "Universe relation updated." }],
    structuredContent: { success: true, data: { relation: updatedRelation, universe_version: 5 } },
  });
  assert.deepEqual(calls, [["user-1", relation.id, { relationType: "extends", strength: 0.25 }, 4]]);
});

test("update Universe relation supports each patch shape and preserves safe failure contracts", async (t) => {
  const calls: unknown[] = [];
  const fixture = await connect({
    universeWriteTools: {
      nodeService: {
        async createMcpNode() { throw new Error("not used"); },
        async updateMcpNode() { throw new Error("not used"); },
      },
      relationService: {
        async createMcpRelation() { throw new Error("not used"); },
        async updateMcpRelation(...args: unknown[]) {
          calls.push(args);
          const patch = args[2] as Record<string, unknown>;
          return { relation: { ...relation, ...(patch.relationType === undefined ? {} : { relationType: patch.relationType }), ...(patch.strength === undefined ? {} : { strength: patch.strength }) }, universe_version: calls.length + 1 };
        },
      },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  for (const [arguments_, expectedPatch] of [
    [{ relation_id: relation.id, expected_version: 1, strength: 0 }, { strength: 0 }],
    [{ relation_id: relation.id, expected_version: 2, relation_type: "raises" }, { relationType: "raises" }],
    [{ relation_id: relation.id, expected_version: 3, relation_type: "part_of", strength: 0.75 }, { relationType: "part_of", strength: 0.75 }],
  ] as const) {
    const response = await fixture.client.callTool({ name: "update_universe_relation", arguments: arguments_ });
    assert.equal(response.isError, undefined);
    assert.deepEqual((calls.at(-1) as unknown[]).slice(1), [relation.id, expectedPatch, arguments_.expected_version]);
  }

  for (const arguments_ of [
    { relation_id: relation.id, expected_version: 4 },
    { relation_id: relation.id, expected_version: 4, strength: 1.1 },
    { relation_id: relation.id, expected_version: 4, strength: Number.NaN },
    { relation_id: relation.id, expected_version: 4, relation_type: "unknown" },
  ]) {
    const response = await fixture.client.callTool({ name: "update_universe_relation", arguments: arguments_ });
    assert.equal(response.isError, true);
  }
  assert.equal(calls.length, 3);

  const authFixture = await connect({
    universeWriteTools: {
      nodeService: { async createMcpNode() { throw new Error("not used"); }, async updateMcpNode() { throw new Error("not used"); } },
      relationService: { async createMcpRelation() { throw new Error("not used"); }, async updateMcpRelation() { throw new Error("must not call"); } },
      getAuthenticatedUserId: () => { throw new UniverseAuthenticationError(); },
    },
  });
  t.after(async () => { await authFixture.client.close(); await authFixture.server.close(); });
  const authResponse = await authFixture.client.callTool({ name: "update_universe_relation", arguments: { relation_id: relation.id, expected_version: 4, strength: 0.5 } });
  assert.equal(authResponse.isError, true);
  assert.match(JSON.stringify(authResponse), /AUTHENTICATION_REQUIRED|Authentication is required/);
});

test("update Universe relation exposes stale and missing relation errors without mutation", async (t) => {
  const calls: string[] = [];
  const fixture = await connect({
    universeWriteTools: {
      nodeService: { async createMcpNode() { throw new Error("not used"); }, async updateMcpNode() { throw new Error("not used"); } },
      relationService: {
        async createMcpRelation() { throw new Error("not used"); },
        async updateMcpRelation(_userId: string, relationId: string) {
          calls.push(relationId);
          throw new UniverseServiceError(relationId === "missing" ? "RELATION_NOT_FOUND" : "VERSION_CONFLICT", "private detail");
        },
      },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  for (const [relationId, code] of [["missing", "RELATION_NOT_FOUND"], [relation.id, "VERSION_CONFLICT"]] as const) {
    const response = await fixture.client.callTool({ name: "update_universe_relation", arguments: { relation_id: relationId, expected_version: 5, strength: 0.5 } });
    assert.equal(response.isError, true);
    assert.match(JSON.stringify(response.structuredContent), new RegExp(code));
    assert.doesNotMatch(JSON.stringify(response), /private detail/);
  }
  assert.deepEqual(calls, ["missing", relation.id]);
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
  assert.deepEqual(result, {
    content: [{ type: "text", text: "Universe node created." }],
    structuredContent: {
      success: true,
      data: {
        node: { id: node.id, title: node.title, type: node.type, createdAt: node.createdAt, updatedAt: node.updatedAt },
        universe_version: 1,
        metadata: { created: true, idempotent_replay: false },
        detail_tool: "get_universe_node",
        detail_arguments: { id: node.id },
      },
    },
  });
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
  assert.deepEqual(result, {
    content: [{ type: "text", text: "Universe node updated." }],
    structuredContent: {
      success: true,
      data: {
        node: { id: node.id, title: node.title, type: node.type, createdAt: node.createdAt, updatedAt: node.updatedAt },
        universe_version: 2,
        detail_tool: "get_universe_node",
        detail_arguments: { id: node.id },
      },
    },
  });
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
  assert.deepEqual(result, {
    content: [{ type: "text", text: "Universe relation created." }],
    structuredContent: {
      success: true,
      data: { relation, universe_version: 3, metadata: { created: true, idempotent_replay: false } },
    },
  });
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
  assert.deepEqual(stale.structuredContent, {
    success: false,
    error: {
      code: "VERSION_CONFLICT",
      message: "Universe changed since expected_version; fresh-read before deciding whether to retry.",
    },
  });
  assert.match(JSON.stringify(stale.content), /VERSION_CONFLICT/);
  assert.match(JSON.stringify(stale), /expected_version|fresh-read/i);

  const missing = await fixture.client.callTool({
    name: "update_universe_node",
    arguments: { id: "missing-node", expected_version: 3, summary: "new summary" },
  });
  assert.equal(missing.isError, true);
  assert.deepEqual(missing.structuredContent, {
    success: false,
    error: {
      code: "NODE_NOT_FOUND",
      message: "Universe node was not updated.",
    },
  });
  assert.match(JSON.stringify(missing.content), /NODE_NOT_FOUND/);

  const self = await fixture.client.callTool({
    name: "create_universe_relation",
    arguments: {
      source: "node-a",
      target: "node-a",
      relation_type: "supports",
      strength: 0,
      expected_version: 3,
      idempotency_key: "relation-error-0000001",
    },
  });
  assert.equal(self.isError, true);
  assert.deepEqual(self.structuredContent, {
    success: false,
    error: {
      code: "RELATION_INVALID",
      message: "The Universe relation request is invalid.",
    },
  });
  assert.match(JSON.stringify(self.content), /RELATION_INVALID/);
});

test("Universe relation and Diary-source mutations expose structured domain errors", async (t) => {
  const fixture = await connect({
    universeProvenanceTools: {
      relationService: {
        async deleteRelation() {
          throw new UniverseServiceError("RELATION_NOT_FOUND", "PRIVATE_RELATION_DETAIL");
        },
      },
      sourceService: {
        async addUniverseDiarySource() {
          throw new UniverseServiceError("DIARY_SOURCE_CONFLICT", "PRIVATE_SOURCE_DETAIL");
        },
        async deleteUniverseDiarySource() {
          throw new UniverseServiceError("DIARY_SOURCE_NOT_FOUND", "PRIVATE_SOURCE_DETAIL");
        },
      },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const cases = [
    {
      name: "delete_universe_relation",
      arguments: { relation_id: "edge-1", expected_version: 2 },
      code: "RELATION_NOT_FOUND",
    },
    {
      name: "add_universe_diary_source",
      arguments: { node_id: "node-1", diary_id: "00000000-0000-4000-8000-000000000111", expected_version: 2 },
      code: "DIARY_SOURCE_CONFLICT",
    },
    {
      name: "delete_universe_diary_source",
      arguments: { node_id: "node-1", diary_id: "00000000-0000-4000-8000-000000000111", expected_version: 2 },
      code: "DIARY_SOURCE_NOT_FOUND",
    },
  ] as const;

  for (const entry of cases) {
    const result = await fixture.client.callTool({ name: entry.name, arguments: entry.arguments });
    assert.equal(result.isError, true, entry.name);
    assert.deepEqual(result.structuredContent, {
      success: false,
      error: {
        code: entry.code,
        message: entry.code === "RELATION_NOT_FOUND"
          ? "Universe relation was not found."
          : entry.code === "DIARY_SOURCE_CONFLICT"
            ? "That Diary is already attached to this Universe node."
            : "That Universe Diary source binding was not found.",
      },
    });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_(?:RELATION|SOURCE)_DETAIL/);
  }
});

test("surfaces duplicate Universe relation code in both MCP result channels", async (t) => {
  let calls = 0;
  const fixture = await connect({
    universeWriteTools: {
      nodeService: {
        async createMcpNode() { throw new Error("not used"); },
        async updateMcpNode() { throw new Error("not used"); },
      },
      relationService: {
        async createMcpRelation() {
          calls += 1;
          throw new UniverseServiceError("RELATION_CONFLICT");
        },
      },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const duplicate = await fixture.client.callTool({
    name: "create_universe_relation",
    arguments: {
      source: "node-a",
      target: "node-b",
      relation_type: "supports",
      strength: 1,
      expected_version: 3,
      idempotency_key: "relation-error-0000002",
    },
  });
  assert.equal(duplicate.isError, true);
  assert.deepEqual(duplicate.structuredContent, {
    success: false,
    error: {
      code: "RELATION_CONFLICT",
      message: "That directional Universe relation already exists.",
    },
  });
  assert.match(JSON.stringify(duplicate.content), /RELATION_CONFLICT/);
  assert.equal(calls, 1);
});

test("preserves idempotent replay metadata in a successful Universe write", async (t) => {
  const fixture = await connect({
    universeWriteTools: {
      nodeService: {
        async createMcpNode() {
          return { node, universe_version: 9, metadata: { created: false, idempotent_replay: true } };
        },
        async updateMcpNode() { throw new Error("not used"); },
      },
      relationService: { async createMcpRelation() { throw new Error("not used"); } },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const replay = await fixture.client.callTool({
    name: "create_universe_node",
    arguments: {
      title: "Node", summary: "Summary", content: "Content", type: "concept", tags: [], galaxies: [],
      position: { x: 0, y: 100 }, expected_version: 8, idempotency_key: "node-replay-0000001",
    },
  });
  assert.deepEqual(replay, {
    content: [{ type: "text", text: "Universe node replayed." }],
    structuredContent: {
      success: true,
      data: {
        node: { id: node.id, title: node.title, type: node.type, createdAt: node.createdAt, updatedAt: node.updatedAt },
        universe_version: 9,
        metadata: { created: false, idempotent_replay: true },
        detail_tool: "get_universe_node",
        detail_arguments: { id: node.id },
      },
    },
  });
});

test("keeps unknown Universe write errors generic and non-sensitive", async (t) => {
  const fixture = await connect({
    universeWriteTools: {
      nodeService: {
        async createMcpNode() { throw new Error("driver secret should not leak"); },
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
      position: { x: 0, y: 100 }, expected_version: 0, idempotency_key: "node-internal-000001",
    },
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.deepEqual(result.content, [{ type: "text", text: "Universe is temporarily unavailable." }]);
  assert.doesNotMatch(JSON.stringify(result), /driver secret should not leak/);
});

test("Universe read errors expose a machine-readable envelope", async (t) => {
  const fixture = await connect({
    universeTools: {
      universeService: {
        async loadUniverse() { throw new UniverseServiceError("NODE_NOT_FOUND"); },
      },
      globalSearchService: { async search() { throw new Error("not used"); } },
      getAuthenticatedUserId: () => "user-1",
    },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({ name: "get_universe_node", arguments: { id: "missing-node" } });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    success: false,
    error: {
      code: "NODE_NOT_FOUND",
      message: "Universe node was not found.",
    },
  });
  assert.deepEqual(result.content, [{ type: "text", text: "Universe node was not found." }]);
});
