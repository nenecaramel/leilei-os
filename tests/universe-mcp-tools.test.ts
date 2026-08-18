import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { UniverseServiceError } from "../src/domains/universe/universe-service.js";
import { UniverseAuthenticationError } from "../src/mcp/tools/universe/shared.js";
import type { UniverseReadResult } from "../src/domains/universe/universe-repository.js";
import type { UniverseSnapshot } from "../src/domains/universe/universe-types.js";
import type { GlobalSearchInput, GlobalSearchResult } from "../src/domains/global-search/global-search-service.js";

const USER_ID = "00000000-0000-4000-8000-000000000701";
const NOW = "2026-08-17T00:00:00.000Z";

const snapshot: UniverseSnapshot = {
  schemaVersion: 2,
  meta: { name: "我的 Universe", createdAt: NOW, updatedAt: NOW },
  galaxies: [{ id: "galaxy-1", title: "第一星系", description: "", color: "#111111", order: 1 }],
  nodes: [
    {
      id: "node-1",
      title: "第一节点",
      summary: "摘要一",
      content: "内容一",
      type: "concept",
      tags: ["tag"],
      galaxies: [{ id: "galaxy-1", weight: 0.8 }],
      position: { x: 20, y: 30 },
      createdAt: NOW,
      updatedAt: NOW,
      importance: "major",
    },
    {
      id: "node-2",
      title: "第二节点",
      summary: "摘要二",
      content: "内容二",
      type: "question",
      tags: [],
      galaxies: [],
      position: { x: 70, y: 80 },
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
  relations: [{ id: "relation-1", source: "node-1", target: "node-2", relationType: "supports", strength: 0.75, createdAt: NOW }],
  revisions: [],
};

const readResult: UniverseReadResult = { snapshot, version: 3 };

async function connect(dependencies: Record<string, unknown> = {}) {
  const server = createMcpServer({ universeTools: dependencies } as never);
  const client = new Client({ name: "universe-mcp-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function searchResult(nextCursor: string | null = null): GlobalSearchResult {
  return {
    results: [{
      entity_type: "universe",
      entity_id: "node-1",
      stable_name: "第一节点",
      snippet: "内容一",
      matched_field: "content",
      match_reason: "field_match",
      lifecycle_status: "active",
      business_time: NOW,
      time_basis: "updated_at",
      updated_at: NOW,
      detail_tool: "get_universe_node",
      detail_arguments: { id: "node-1" },
    }],
    metadata: {
      count: 1,
      has_more: nextCursor !== null,
      next_cursor: nextCursor,
      searched_modules: ["universe"],
      searched_scope: "active",
    },
  };
}

test("Phase 8.5 registers dedicated Universe read tools", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const names = (await fixture.client.listTools()).tools.map((tool) => tool.name);
  assert.deepEqual(names.filter((name) => name.includes("universe")).sort(), ["get_universe_node", "get_universe_relations", "search_universe"]);
  assert.equal(names.length, 28);
});

test("search_universe validates input, forwards limit/cursor, and preserves pagination output", async (t) => {
  const calls: GlobalSearchInput[] = [];
  const fixture = await connect({
    globalSearchService: {
      async search(input: GlobalSearchInput) {
        calls.push(input);
        if (input.query === "不存在") {
          return { results: [], metadata: { count: 0, has_more: false, next_cursor: null, searched_modules: ["universe"], searched_scope: "active" } };
        }
        return searchResult(input.cursor ? null : "next-cursor");
      },
    },
    getAuthenticatedUserId: () => USER_ID,
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const first = await fixture.client.callTool({ name: "search_universe", arguments: { query: "旅行", limit: 5 } });
  assert.equal(first.isError, undefined);
  assert.equal((first.structuredContent as { data: GlobalSearchResult }).data.metadata.next_cursor, "next-cursor");
  const second = await fixture.client.callTool({ name: "search_universe", arguments: { query: "旅行", limit: 5, cursor: "next-cursor" } });
  assert.equal(second.isError, undefined);
  assert.equal(calls[0]?.modules[0], "universe");
  assert.equal(calls[0]?.limit, 5);
  assert.equal(calls[1]?.cursor, "next-cursor");
  const empty = await fixture.client.callTool({ name: "search_universe", arguments: { query: "不存在" } });
  assert.equal(empty.isError, undefined);
  assert.equal((empty.structuredContent as { data: GlobalSearchResult }).data.metadata.count, 0);
  const invalid = await fixture.client.callTool({ name: "search_universe", arguments: { query: "" } });
  assert.equal(invalid.isError, true);
  const identityInjection = await fixture.client.callTool({ name: "search_universe", arguments: { query: "旅行", user_id: USER_ID } });
  assert.equal(identityInjection.isError, true);
  assert.equal(calls.length, 3);
});

test("get_universe_node returns canonical node fields and enforces exact IDs", async (t) => {
  let calls = 0;
  const fixture = await connect({
    universeService: {
      async loadUniverse(userId: string) {
        assert.equal(userId, USER_ID);
        calls += 1;
        return readResult;
      },
    },
    getAuthenticatedUserId: () => USER_ID,
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const result = await fixture.client.callTool({ name: "get_universe_node", arguments: { id: "node-1" } });
  assert.equal(result.isError, undefined);
  const node = (result.structuredContent as { data: typeof snapshot.nodes[number] }).data;
  assert.equal(node.id, "node-1");
  assert.equal((result.structuredContent as { data: { universe_version: number } }).data.universe_version, 3);
  const nodeTool = (await fixture.client.listTools()).tools.find((tool) => tool.name === "get_universe_node");
  assert.match(JSON.stringify(nodeTool?.outputSchema), /universe_version/);
  assert.deepEqual(node.galaxies, [{ id: "galaxy-1", weight: 0.8 }]);
  assert.equal(node.importance, "major");
  assert.equal(calls, 1);

  const invalid = await fixture.client.callTool({ name: "get_universe_node", arguments: { id: "" } });
  assert.equal(invalid.isError, true);
  const identityInjection = await fixture.client.callTool({ name: "get_universe_node", arguments: { id: "node-1", user_id: USER_ID } });
  assert.equal(identityInjection.isError, true);
  const missing = await fixture.client.callTool({ name: "get_universe_node", arguments: { id: "missing" } });
  assert.equal(missing.isError, true);
  assert.match(JSON.stringify(missing), /not found/i);
});

test("get_universe_relations returns stable relation references and handles uninitialized Universe", async (t) => {
  const fixture = await connect({
    universeService: {
      async loadUniverse() {
        return readResult;
      },
    },
    getAuthenticatedUserId: () => USER_ID,
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const result = await fixture.client.callTool({ name: "get_universe_relations", arguments: { node_id: "node-1" } });
  assert.equal(result.isError, undefined);
  const data = (result.structuredContent as { data: { node_id: string; relations: typeof snapshot.relations; universe_version: number } }).data;
  assert.equal(data.node_id, "node-1");
  assert.equal(data.universe_version, 3);
  const relationTool = (await fixture.client.listTools()).tools.find((tool) => tool.name === "get_universe_relations");
  assert.match(JSON.stringify(relationTool?.outputSchema), /universe_version/);
  assert.deepEqual(data.relations[0], {
    id: "relation-1", source: "node-1", target: "node-2", relation_type: "supports", strength: 0.75, created_at: NOW,
  });
  const identityInjection = await fixture.client.callTool({ name: "get_universe_relations", arguments: { node_id: "node-1", userId: USER_ID } });
  assert.equal(identityInjection.isError, true);

  const uninitialized = await connect({
    universeService: { async loadUniverse() { throw new UniverseServiceError("UNIVERSE_NOT_INITIALIZED"); } },
    getAuthenticatedUserId: () => USER_ID,
  });
  t.after(async () => { await uninitialized.client.close(); await uninitialized.server.close(); });
  const empty = await uninitialized.client.callTool({ name: "get_universe_relations", arguments: { node_id: "node-1" } });
  assert.equal(empty.isError, true);
  assert.match(JSON.stringify(empty), /not initialized/i);
});

test("Universe MCP tools fail closed at authentication and ownership boundaries", async (t) => {
  const fixture = await connect({
    globalSearchService: { async search() { throw new Error("must not call"); } },
    universeService: { async loadUniverse() { throw new Error("must not call"); } },
    getAuthenticatedUserId: () => { throw new UniverseAuthenticationError(); },
  });
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  for (const name of ["search_universe", "get_universe_node", "get_universe_relations"]) {
    const args = name === "search_universe" ? { query: "x" } : name === "get_universe_node" ? { id: "node-1" } : { node_id: "node-1" };
    const result = await fixture.client.callTool({ name, arguments: args });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /authentication|unauthorized/i);
  }
});
