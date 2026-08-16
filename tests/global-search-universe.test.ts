import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GlobalSearchService, type GlobalSearchResult } from "../src/domains/global-search/global-search-service.js";
import type { GlobalSearchQuery, GlobalSearchRepository, GlobalSearchRow } from "../src/domains/global-search/global-search-repository.js";
import { createGlobalSearchApiHandler } from "../src/web-api/global-search-router.js";
import type { Request, Response } from "express";
import { readUniverseNodeTarget } from "../web/src/pages/universe/universe-location.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID = "00000000-0000-4000-8000-000000000701";
const NODE_ID = "thought-node-1";

class UniverseSearchRepository implements GlobalSearchRepository {
  calls: GlobalSearchQuery[] = [];
  rows: GlobalSearchRow[] = [{
    entityType: "universe",
    entityId: NODE_ID,
    stableName: "宇宙节点",
    matchedField: "content",
    matchedValue: "关于旅行的宇宙节点",
    matchReason: "field_match",
    lifecycleStatus: "active",
    businessTime: new Date("2026-08-10T12:00:00.000Z"),
    timeBasis: "updated_at",
    updatedAt: new Date("2026-08-10T12:00:00.000Z"),
    rank: 4,
  }];

  async findUser() {
    return { status: "active" as const, timezone: "Asia/Shanghai" };
  }

  async search(input: GlobalSearchQuery) {
    this.calls.push(input);
    return this.rows;
  }
}

test("Universe participates in the shared search contract with stable identity and no detail-tool fiction", async () => {
  const repository = new UniverseSearchRepository();
  const result = await new GlobalSearchService(repository).search({
    userId: USER_ID,
    query: "旅行",
    modules: ["universe"],
    scope: "active",
    limit: 10,
  });

  assert.deepEqual(result.metadata.searched_modules, ["universe"]);
  assert.equal(result.results[0]?.entity_type, "universe");
  assert.equal(result.results[0]?.entity_id, NODE_ID);
  assert.equal(result.results[0]?.stable_name, "宇宙节点");
  assert.match(result.results[0]?.snippet ?? "", /旅行/);
  assert.equal(result.results[0]?.detail_tool, null);
  assert.equal(result.results[0]?.detail_arguments, null);
  assert.equal(repository.calls[0]?.scope, "active");
});

test("Universe is excluded from archived scope and an uninitialized Universe is an empty search result", async () => {
  const repository = new UniverseSearchRepository();
  const service = new GlobalSearchService(repository);
  repository.rows = [];
  const empty = await service.search({ userId: USER_ID, query: "旅行", modules: ["universe"], scope: "active" });
  assert.deepEqual(empty.results, []);
  assert.equal(empty.metadata.count, 0);

  repository.rows = [];
  const archived = await service.search({ userId: USER_ID, query: "旅行", modules: ["universe"], scope: "archived" });
  assert.deepEqual(archived.results, []);
});

test("Universe text IDs remain valid through the shared keyset cursor", async () => {
  const repository = new UniverseSearchRepository();
  repository.rows = [
    ...repository.rows,
    { ...repository.rows[0]!, entityId: "node-2", stableName: "第二节点", matchedValue: "旅行第二节点", businessTime: new Date("2026-08-09T12:00:00.000Z"), updatedAt: new Date("2026-08-09T12:00:00.000Z") },
  ];
  const service = new GlobalSearchService(repository);
  const first = await service.search({ userId: USER_ID, query: "旅行", modules: ["universe"], limit: 1 });
  assert.ok(first.metadata.next_cursor);
  await service.search({ userId: USER_ID, query: "旅行", modules: ["universe"], limit: 1, cursor: first.metadata.next_cursor! });
  assert.equal(repository.calls.at(-1)?.after?.entityType, "universe");
  assert.equal(repository.calls.at(-1)?.after?.entityId, NODE_ID);
});

function recorder() {
  const state: { status: number; body?: unknown; headers: Record<string, string> } = { status: 200, headers: {} };
  const response = {
    status(code: number) { state.status = code; return this; },
    json(body: unknown) { state.body = body; return this; },
    set(name: string, value: string) { state.headers[name] = value; return this; },
  } as unknown as Response;
  return { state, response };
}

test("Web API accepts the Universe module without accepting a client identity selector", async () => {
  const calls: GlobalSearchQuery[] = [];
  const result: GlobalSearchResult = {
    results: [],
    metadata: { count: 0, has_more: false, next_cursor: null, searched_modules: ["universe"], searched_scope: "active" },
  };
  const handler = createGlobalSearchApiHandler({ globalSearchService: { async search(input) { calls.push(input); return result; } } });
  const { state, response } = recorder();
  await handler({ webUserId: USER_ID, query: { query: "旅行", modules: "universe" } } as unknown as Request, response, () => {});
  assert.equal(state.status, 200);
  assert.deepEqual(calls[0]?.modules, ["universe"]);

  const rejected = recorder();
  await handler({ webUserId: USER_ID, query: { query: "旅行", modules: "universe", user_id: "attacker" } } as unknown as Request, rejected.response, () => {});
  assert.equal(rejected.state.status, 400);
  assert.equal(calls.length, 1);
});

test("Universe navigation accepts only an existing node from the search route", () => {
  assert.equal(readUniverseNodeTarget("?node=thought-node-1", ["thought-node-1"]), "thought-node-1");
  assert.equal(readUniverseNodeTarget("?node=missing", ["thought-node-1"]), null);
  assert.equal(readUniverseNodeTarget("?node=thought-node-1&user_id=other", ["thought-node-1"]), "thought-node-1");
});

test("MCP global_search accepts Universe results without inventing a detail tool", async (t) => {
  const result: GlobalSearchResult = {
    results: [{
      entity_type: "universe",
      entity_id: NODE_ID,
      stable_name: "宇宙节点",
      snippet: "关于旅行的宇宙节点",
      matched_field: "content",
      match_reason: "field_match",
      lifecycle_status: "active",
      business_time: "2026-08-10T12:00:00.000Z",
      time_basis: "updated_at",
      updated_at: "2026-08-10T12:00:00.000Z",
      detail_tool: null,
      detail_arguments: null,
    }],
    metadata: { count: 1, has_more: false, next_cursor: null, searched_modules: ["universe"], searched_scope: "active" },
  };
  const calls: GlobalSearchQuery[] = [];
  const server = createMcpServer({
    globalSearch: {
      globalSearchService: { async search(input) { calls.push(input); return result; } },
      getAuthenticatedUserId: () => USER_ID,
    },
  });
  const client = new Client({ name: "universe-search-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const response = await client.callTool({ name: "global_search", arguments: { query: "旅行", modules: ["universe"] } });
  assert.equal(response.isError, undefined);
  assert.deepEqual(calls[0]?.modules, ["universe"]);
  assert.equal((response.structuredContent as { data: GlobalSearchResult }).data.results[0]?.detail_tool, null);
});
