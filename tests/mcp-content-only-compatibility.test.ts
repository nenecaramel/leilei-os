import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetDiaryTool } from "../src/mcp/tools/get-diary/register.js";
import { registerSearchDiaryTool } from "../src/mcp/tools/search-diary/register.js";
import { registerListTodoDatesTool } from "../src/mcp/tools/list-todo-dates/register.js";
import { registerReadTodoDayTool } from "../src/mcp/tools/read-todo-day/register.js";
import { registerGlobalSearchTool } from "../src/mcp/tools/global-search/register.js";
import { registerListUniverseNodesTool } from "../src/mcp/tools/list-universe-nodes/register.js";
import { registerGetUniverseNodeTool } from "../src/mcp/tools/get-universe-node/register.js";
import { registerGetUniverseRelationsTool } from "../src/mcp/tools/get-universe-relations/register.js";
import { registerGetUniverseDiarySourcesTool } from "../src/mcp/tools/get-universe-diary-sources/register.js";
import { assertContentIncludes, contentText } from "./helpers/mcp-content-only.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const DIARY_ID = "00000000-0000-4000-8000-000000000301";
const DATE = "2026-09-05";
const DIARY_BODY = "Diary body visible to a content-only client.";
const NODE_ID = "node-content-only";

async function connect(register: (server: McpServer) => void) {
  const server = new McpServer({ name: "mcp-content-only-compatibility", version: "1.0.0" });
  register(server);
  const client = new Client({ name: "content-only-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

const diary = {
  id: DIARY_ID,
  title: "A day with a title",
  content: DIARY_BODY,
  date: DATE,
  tags: ["compatibility"],
  mood: "focused",
  created_at: "2026-09-05T00:00:00.000Z",
  updated_at: "2026-09-05T01:00:00.000Z",
  author: "G" as const,
};

test("Diary search content contains a compact real-id detail pointer and detail content contains the body", async (t) => {
  const pair = await connect((server) => {
    const service = {
      async searchDiaryDiscovery() {
        return {
          diaries: [{
            id: DIARY_ID,
            title: diary.title,
            date: DATE,
            tags: diary.tags,
            mood: diary.mood,
            created_at: diary.created_at,
            updated_at: diary.updated_at,
            author: diary.author,
            snippet: null,
          }],
          metadata: { count: 1 },
        };
      },
      async listDiaries() { return { diaries: [diary], metadata: { count: 1 } }; },
      async readDiary() { return diary; },
    };
    registerSearchDiaryTool(server, { diaryService: service, getAuthenticatedUserId: () => USER_ID });
    registerGetDiaryTool(server, { diaryService: service, getAuthenticatedUserId: () => USER_ID });
  });
  t.after(async () => { await pair.client.close(); await pair.server.close(); });

  const search = await pair.client.callTool({ name: "search_diary", arguments: { date_from: DATE, date_to: DATE } });
  assertContentIncludes(search, DIARY_ID, DATE, diary.title, "get_diary", `id=${DIARY_ID}`);
  assert.deepEqual((search.structuredContent as { data: unknown }).data, {
    diaries: [{
      id: DIARY_ID,
      title: diary.title,
      date: DATE,
      tags: diary.tags,
      mood: diary.mood,
      created_at: diary.created_at,
      updated_at: diary.updated_at,
      author: diary.author,
      snippet: null,
      detail_tool: "get_diary",
      detail_arguments: { id: DIARY_ID, scope: "active" },
    }],
    metadata: { count: 1, returned: 1, has_more: false, next_cursor: null },
  });

  const detail = await pair.client.callTool({ name: "get_diary", arguments: { id: DIARY_ID } });
  assertContentIncludes(detail, diary.title, DATE, DIARY_BODY);
  assert.equal((detail.structuredContent as { data: { content: string } }).data.content, DIARY_BODY);
});

test("get_diary rejects a date before the service and reports invalid arguments", async (t) => {
  let readCalls = 0;
  const pair = await connect((server) => registerGetDiaryTool(server, {
    diaryService: {
      async readDiary() { readCalls += 1; throw new Error("must not reach the service"); },
    },
    getAuthenticatedUserId: () => USER_ID,
  }));
  t.after(async () => { await pair.client.close(); await pair.server.close(); });

  const result = await pair.client.callTool({ name: "get_diary", arguments: { id: DATE } });
  assert.equal(result.isError, true);
  assert.match(contentText(result), /invalid arguments|uuid/i);
  assert.equal(readCalls, 0);
});

test("Todo day content exposes entries and explicitly identifies an empty day", async (t) => {
  const pair = await connect((server) => {
    const service = {
      async readDay(_userId: string, date: string) {
        return date === DATE
          ? { date, papers: { L: { date, author: "L" as const, revision: 3, entries: [{ id: "todo-1", kind: "pending" as const, text: "Buy tea" }] }, G: null, C: null } }
          : { date, papers: { L: null, G: null, C: null } };
      },
      async listDates() { return [DATE]; },
    };
    registerReadTodoDayTool(server, { todoService: service, getAuthenticatedUserId: () => USER_ID });
    registerListTodoDatesTool(server, { todoService: service, getAuthenticatedUserId: () => USER_ID });
  });
  t.after(async () => { await pair.client.close(); await pair.server.close(); });

  const populated = await pair.client.callTool({ name: "read_todo_day", arguments: { date: DATE } });
  assertContentIncludes(populated, DATE, "L", "Buy tea", "todo-1");
  assert.deepEqual((populated.structuredContent as { data: unknown }).data, {
    date: DATE,
    papers: { L: { date: DATE, author: "L", revision: 3, entries: [{ id: "todo-1", kind: "pending", text: "Buy tea", revision: 1 }] }, G: null, C: null },
  });

  const empty = await pair.client.callTool({ name: "read_todo_day", arguments: { date: "2026-09-06" } });
  assertContentIncludes(empty, "2026-09-06", "empty");

  const dates = await pair.client.callTool({ name: "list_todo_dates", arguments: {} });
  assertContentIncludes(dates, DATE);
});

test("Global and Universe discovery/detail content exposes identifiers and bodies", async (t) => {
  const now = "2026-09-05T01:00:00.000Z";
  const pair = await connect((server) => {
    const globalSearchService = {
      async search() {
        return {
          results: [{
            entity_type: "universe" as const,
            entity_id: NODE_ID,
            stable_name: "Universe node",
            snippet: "Universe snippet",
            matched_field: "content" as const,
            match_reason: "field_match" as const,
            lifecycle_status: "active" as const,
            author: null,
            business_time: now,
            time_basis: "updated_at" as const,
            updated_at: now,
            detail_tool: "get_universe_node" as const,
            detail_arguments: { id: NODE_ID },
          }],
          metadata: { count: 1, has_more: false, next_cursor: null, searched_modules: ["universe" as const], searched_scope: "active" as const, searched_author: null },
        };
      },
    };
    const universeService = {
      async listUniverseNodes() {
        return { nodes: [{ id: NODE_ID, title: "Universe node", type: "concept", tags: [], galaxies: [], importance: null, updatedAt: new Date(now), summaryPreview: "Universe summary" }], hasMore: false, version: 4 };
      },
      async readUniverseNode() {
        return { node: { id: NODE_ID, title: "Universe node", summary: "Universe summary", content: "Universe body", type: "concept", tags: [], galaxies: [], position: { x: 1, y: 2 }, createdAt: now, updatedAt: now }, version: 4 };
      },
    };
    registerGlobalSearchTool(server, { globalSearchService, getAuthenticatedUserId: () => USER_ID } as never);
    registerListUniverseNodesTool(server, { universeService, getAuthenticatedUserId: () => USER_ID } as never);
    registerGetUniverseNodeTool(server, { universeService, getAuthenticatedUserId: () => USER_ID } as never);
  });
  t.after(async () => { await pair.client.close(); await pair.server.close(); });

  for (const name of ["global_search"] as const) {
    const result = await pair.client.callTool({ name, arguments: { query: "node" } });
    assertContentIncludes(result, NODE_ID, "get_universe_node");
  }
  const listed = await pair.client.callTool({ name: "list_universe_nodes", arguments: {} });
  assertContentIncludes(listed, NODE_ID, "Universe node", "get_universe_node");
  const node = await pair.client.callTool({ name: "get_universe_node", arguments: { id: NODE_ID } });
  assertContentIncludes(node, NODE_ID, "Universe node", "Universe body");
});

test("Universe neighborhood and provenance content exposes decision-critical values", async (t) => {
  const pair = await connect((server) => {
    const universeService = {
      async loadUniverse() {
        return {
          snapshot: {
            nodes: [{ id: NODE_ID }],
            relations: [{ id: "relation-1", source: NODE_ID, target: "node-2", relationType: "supports", strength: 0.8, createdAt: "2026-09-05T00:00:00.000Z" }],
          },
          version: 5,
        };
      },
      async getUniverseDiarySources() {
        return { sources: [{ diaryId: DIARY_ID, title: diary.title, date: DATE, status: "active" as const }], version: 5 };
      },
    };
    registerGetUniverseRelationsTool(server, { universeService, getAuthenticatedUserId: () => USER_ID } as never);
    registerGetUniverseDiarySourcesTool(server, { sourceService: universeService, getAuthenticatedUserId: () => USER_ID } as never);
  });
  t.after(async () => { await pair.client.close(); await pair.server.close(); });

  const relations = await pair.client.callTool({ name: "get_universe_relations", arguments: { node_id: NODE_ID } });
  assertContentIncludes(relations, NODE_ID, "relation-1", "supports", "0.8");
  const sources = await pair.client.callTool({ name: "get_universe_diary_sources", arguments: { node_id: NODE_ID } });
  assertContentIncludes(sources, NODE_ID, DIARY_ID, diary.title, DATE, "active");
});
