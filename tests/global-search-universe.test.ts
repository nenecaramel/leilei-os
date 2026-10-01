import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GlobalSearchService, type GlobalSearchResult } from "../src/domains/global-search/global-search-service.js";
import type { GlobalSearchQuery, GlobalSearchRepository, GlobalSearchRow } from "../src/domains/global-search/global-search-repository.js";
import { createGlobalSearchApiHandler } from "../src/web-api/global-search-router.js";
import type { Request, Response } from "express";
import { consumeUniverseNodeTarget } from "../web/src/pages/universe/universe-location.js";
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

test("Universe participates in the shared search contract with a direct exact-read link", async () => {
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
  assert.equal(result.results[0]?.detail_tool, "get_universe_node");
  assert.deepEqual(result.results[0]?.detail_arguments, { id: NODE_ID });
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

test("Universe canonical IDs remain valid through the shared keyset cursor", async () => {
  const repository = new UniverseSearchRepository();
  repository.rows = [
    { ...repository.rows[0]!, entityId: "节点 A", stableName: "第一节点", matchedValue: "旅行第一节点" },
    { ...repository.rows[0]!, entityId: "合法".repeat(100), stableName: "第二节点", matchedValue: "旅行第二节点", businessTime: new Date("2026-08-09T12:00:00.000Z"), updatedAt: new Date("2026-08-09T12:00:00.000Z") },
  ];
  const service = new GlobalSearchService(repository);
  const first = await service.search({ userId: USER_ID, query: "旅行", modules: ["universe"], limit: 1 });
  assert.ok(first.metadata.next_cursor);
  await service.search({ userId: USER_ID, query: "旅行", modules: ["universe"], limit: 1, cursor: first.metadata.next_cursor! });
  assert.equal(repository.calls.at(-1)?.after?.entityType, "universe");
  assert.equal(repository.calls.at(-1)?.after?.entityId, "节点 A");
});

test("Universe cursor accepts canonical IDs through 256 characters and rejects invalid IDs for each module", async () => {
  const repository = new UniverseSearchRepository();
  repository.rows = [
    { ...repository.rows[0]!, entityId: "节点 A", stableName: "第一节点", matchedValue: "旅行第一节点" },
    { ...repository.rows[0]!, entityId: "第二节点", stableName: "第二节点", matchedValue: "旅行第二节点", businessTime: new Date("2026-08-09T12:00:00.000Z"), updatedAt: new Date("2026-08-09T12:00:00.000Z") },
  ];
  const service = new GlobalSearchService(repository);
  const first = await service.search({ userId: USER_ID, query: "旅行", modules: ["universe"], limit: 1 });
  assert.ok(first.metadata.next_cursor);
  const payload = JSON.parse(Buffer.from(first.metadata.next_cursor!, "base64url").toString("utf8")) as { t: { entityType: string; entityId: string } };
  payload.t.entityType = "universe";
  payload.t.entityId = "长".repeat(256);
  const maxLengthCursor = Buffer.from(JSON.stringify(payload)).toString("base64url");
  await assert.doesNotReject(service.search({ userId: USER_ID, query: "旅行", modules: ["universe"], limit: 1, cursor: maxLengthCursor }));

  payload.t.entityId = "x".repeat(257);
  const overlongCursor = Buffer.from(JSON.stringify(payload)).toString("base64url");
  await assert.rejects(service.search({ userId: USER_ID, query: "旅行", modules: ["universe"], limit: 1, cursor: overlongCursor }), (error: unknown) => (error as { code?: string }).code === "INVALID_GLOBAL_SEARCH");

  const diaryFirst = await service.search({ userId: USER_ID, query: "旅行", modules: ["diary"], limit: 1 });
  assert.ok(diaryFirst.metadata.next_cursor);
  const diaryPayload = JSON.parse(Buffer.from(diaryFirst.metadata.next_cursor!, "base64url").toString("utf8")) as { t: { entityType: string; entityId: string } };
  diaryPayload.t.entityType = "diary";
  diaryPayload.t.entityId = "not-a-uuid";
  const nonUuidCursor = Buffer.from(JSON.stringify(diaryPayload)).toString("base64url");
  await assert.rejects(service.search({ userId: USER_ID, query: "旅行", modules: ["diary"], limit: 1, cursor: nonUuidCursor }), (error: unknown) => (error as { code?: string }).code === "INVALID_GLOBAL_SEARCH");
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
    metadata: { count: 0, has_more: false, next_cursor: null, searched_modules: ["universe"], searched_scope: "active", searched_author: null },
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
  assert.equal(consumeUniverseNodeTarget("?node=thought-node-1", ["thought-node-1"])?.nodeId, "thought-node-1");
  assert.equal(consumeUniverseNodeTarget("?node=missing", ["thought-node-1"]), null);
  assert.equal(consumeUniverseNodeTarget("?node=thought-node-1&user_id=other", ["thought-node-1"])?.nodeId, "thought-node-1");
});

test("Universe search deep-link is consumed once so later map selection is not overwritten", () => {
  const consumed = consumeUniverseNodeTarget("?node=thought-node-1&from=search", ["thought-node-1", "thought-node-2"]);
  assert.deepEqual(consumed, { nodeId: "thought-node-1", remainingSearch: "?from=search" });
  assert.equal(consumeUniverseNodeTarget(consumed?.remainingSearch ?? "", ["thought-node-1", "thought-node-2"]), null);
  assert.deepEqual(consumeUniverseNodeTarget("?node=thought-node-2", ["thought-node-1", "thought-node-2"]), { nodeId: "thought-node-2", remainingSearch: "" });
});

test("MCP global_search returns an exact-read link for Universe results", async (t) => {
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
      author: null,
      detail_tool: "get_universe_node",
      detail_arguments: { id: NODE_ID },
    }],
    metadata: { count: 1, has_more: false, next_cursor: null, searched_modules: ["universe"], searched_scope: "active", searched_author: null },
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
  const hit = (response.structuredContent as { data: GlobalSearchResult }).data.results[0];
  assert.equal(hit?.detail_tool, "get_universe_node");
  assert.deepEqual(hit?.detail_arguments, { id: NODE_ID });
});

test("MCP global_search round-trips a canonical 256-character Universe cursor", async (t) => {
  const longId = "长".repeat(256);
  const firstRow: GlobalSearchRow = {
    entityType: "universe",
    entityId: longId,
    stableName: "长 ID 节点",
    matchedField: "title",
    matchedValue: "旅行",
    matchReason: "field_match",
    lifecycleStatus: "active",
    businessTime: new Date("2026-08-10T12:00:00.000Z"),
    timeBasis: "updated_at",
    updatedAt: new Date("2026-08-10T12:00:00.000Z"),
    rank: 4,
    author: null,
  };
  const secondRow: GlobalSearchRow = { ...firstRow, entityId: "第二节点", stableName: "第二节点" };
  const repository: GlobalSearchRepository = {
    async findUser() {
      return { status: "active" as const, timezone: "Asia/Shanghai" };
    },
    async search(input) {
      return input.after ? [secondRow] : [firstRow, secondRow];
    },
  };
  const server = createMcpServer({
    globalSearch: {
      globalSearchService: new GlobalSearchService(repository),
      getAuthenticatedUserId: () => USER_ID,
    },
  });
  const client = new Client({ name: "universe-search-cursor-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const first = await client.callTool({ name: "global_search", arguments: { query: "旅行", modules: ["universe"], limit: 1 } });
  assert.equal(first.isError, undefined);
  const firstData = (first.structuredContent as { data: GlobalSearchResult }).data;
  assert.equal(firstData.metadata.has_more, true);
  const cursor = firstData.metadata.next_cursor;
  assert.ok(cursor);
  assert.ok(cursor.length > 1200);

  const second = await client.callTool({ name: "global_search", arguments: { query: "旅行", modules: ["universe"], limit: 1, cursor } });
  assert.equal(second.isError, undefined);
  assert.equal((second.structuredContent as { data: GlobalSearchResult }).data.results[0]?.entity_id, "第二节点");

  const tooLong = await client.callTool({ name: "global_search", arguments: { query: "旅行", modules: ["universe"], cursor: "a".repeat(2801) } });
  assert.equal(tooLong.isError, true);
});
