import assert from "node:assert/strict";
import test from "node:test";
import { GlobalSearchService, type GlobalSearchResult } from "../src/domains/global-search/global-search-service.js";
import type { GlobalSearchQuery, GlobalSearchRepository, GlobalSearchRow } from "../src/domains/global-search/global-search-repository.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const TODO_ROW: GlobalSearchRow = {
  entityType: "todo",
  entityId: "00000000-0000-4000-8000-000000000201",
  stableName: "2026-08-13 C pending",
  matchedField: "text",
  matchedValue: "Plan the next release",
  matchReason: "field_match",
  lifecycleStatus: "active",
  businessTime: new Date("2026-08-13T00:00:00.000Z"),
  timeBasis: "todo_date",
  updatedAt: new Date("2026-08-13T00:00:00.000Z"),
  rank: 4,
  author: "C",
  businessDate: "2026-08-13",
};

class Repository implements GlobalSearchRepository {
  calls: GlobalSearchQuery[] = [];
  async findUser() { return { status: "active" as const, timezone: "Asia/Shanghai" }; }
  async search(input: GlobalSearchQuery) { this.calls.push(input); return input.modules.includes("todo") ? [TODO_ROW] : []; }
}

test("Global Search includes Todo by default and returns an entry detail pointer", async () => {
  const repository = new Repository();
  const result = await new GlobalSearchService(repository).search({ userId: USER_ID, query: "release" });
  assert.deepEqual(result.metadata.searched_modules, ["diary", "todo", "universe"]);
  assert.deepEqual(result.results[0], {
    entity_type: "todo",
    entity_id: TODO_ROW.entityId,
    stable_name: TODO_ROW.stableName,
    snippet: "Plan the next release",
    matched_field: "text",
    match_reason: "field_match",
    lifecycle_status: "active",
    business_time: "2026-08-13T00:00:00.000Z",
    time_basis: "todo_date",
    updated_at: "2026-08-13T00:00:00.000Z",
    author: "C",
    detail_tool: "read_todo_day",
    detail_arguments: { date: "2026-08-13" },
  });
});

test("Global Search accepts an explicit Todo-only module and keeps archived scope excluded", async () => {
  const repository = new Repository();
  const service = new GlobalSearchService(repository);
  const result = await service.search({ userId: USER_ID, query: "release", modules: ["todo"] });
  assert.deepEqual(result.metadata.searched_modules, ["todo"]);
  assert.equal(repository.calls.at(-1)?.modules[0], "todo");
  await service.search({ userId: USER_ID, query: "release", modules: ["todo"], scope: "archived" });
  assert.equal(repository.calls.at(-1)?.scope, "archived");
});

test("Todo detail pointers use the raw business date instead of UTC conversion", async () => {
  const repository = new Repository();
  repository.result = [{
    ...TODO_ROW,
    businessTime: new Date("2026-08-12T16:00:00.000Z"),
    businessDate: "2026-08-13",
  }];

  const result = await new GlobalSearchService(repository).search({
    userId: USER_ID,
    query: "release",
    modules: ["todo"],
    limit: 10,
  });

  assert.deepEqual(result.results[0]?.detail_arguments, { date: "2026-08-13" });
});

test("MCP global_search exposes Todo in its module schema", async (t) => {
  const result: GlobalSearchResult = {
    results: [],
    metadata: { count: 0, has_more: false, next_cursor: null, searched_modules: ["todo"], searched_scope: "active", searched_author: null },
  };
  const server = createMcpServer({ globalSearch: { globalSearchService: { async search() { return result; } }, getAuthenticatedUserId: () => USER_ID } });
  const client = new Client({ name: "todo-global-search", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const tool = (await client.listTools()).tools.find((entry) => entry.name === "global_search");
  assert.ok(tool);
  assert.match(JSON.stringify(tool.inputSchema), /todo/);
  const response = await client.callTool({ name: "global_search", arguments: { query: "x", modules: ["todo"] } });
  assert.deepEqual(response.structuredContent, { success: true, data: result });
});
