import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GlobalSearchService,
  type GlobalSearchResult,
} from "../src/domains/global-search/global-search-service.js";
import type {
  GlobalSearchQuery,
  GlobalSearchRepository,
  GlobalSearchRow,
} from "../src/domains/global-search/global-search-repository.js";
import {
  registerGlobalSearchTool,
} from "../src/mcp/tools/global-search/register.js";

const USER_ID =
  "00000000-0000-4000-8000-000000000099";
const DIARY_ID =
  "00000000-0000-4000-8000-000000000001";
const TODO_ID =
  "00000000-0000-4000-8000-000000000002";

function row(
  overrides: Partial<GlobalSearchRow> = {},
): GlobalSearchRow {
  return {
    entityType: "diary",
    entityId: DIARY_ID,
    stableName: "Diary",
    matchedField: "content",
    matchedValue: "计划内容",
    matchReason: "field_match",
    lifecycleStatus: "active",
    businessTime:
      new Date("2026-08-01T00:00:00.000Z"),
    timeBasis: "diary_date",
    updatedAt:
      new Date("2026-08-01T00:00:00.000Z"),
    rank: 4,
    author: "C",
    businessDate: null,
    ...overrides,
  };
}

class FakeRepository
implements GlobalSearchRepository {
  queries: GlobalSearchQuery[] = [];
  rows: GlobalSearchRow[] = [row()];

  async findUser() {
    return {
      status: "active" as const,
      timezone: "Asia/Shanghai",
    };
  }

  async search(
    input: GlobalSearchQuery,
  ) {
    this.queries.push(input);
    return this.rows;
  }
}

test("Global Search defaults to Diary Todo and Universe", async () => {
  const repository = new FakeRepository();
  const service =
    new GlobalSearchService(repository);

  const result = await service.search({
    userId: USER_ID,
    query: "计划",
  });

  assert.deepEqual(
    result.metadata.searched_modules,
    ["diary", "todo", "universe", "mind"],
  );
  assert.deepEqual(
    repository.queries[0]?.modules,
    ["diary", "todo", "universe", "mind"],
  );
  assert.equal(repository.queries[0]?.author, undefined);
  assert.equal(result.metadata.searched_author, null);
});

test("Global Search forwards author filters and reports the applied author", async () => {
  const repository = new FakeRepository();
  const service = new GlobalSearchService(repository);

  const result = await service.search({
    userId: USER_ID,
    query: "计划",
    author: "G",
  });

  assert.equal(repository.queries[0]?.author, "G");
  assert.equal(result.metadata.searched_author, "G");

  await assert.rejects(
    service.search({
      userId: USER_ID,
      query: "计划",
      author: "X",
    }),
    /invalid/i,
  );
});

test("Global Search rejects retired modules", async () => {
  const service =
    new GlobalSearchService(
      new FakeRepository(),
    );

  for (const module of [
    "memory",
    "task",
    "shared_paper",
    "conversation",
  ]) {
    await assert.rejects(
      service.search({
        userId: USER_ID,
        query: "x",
        modules: [module],
      }),
      /invalid/i,
    );
  }
});

test("Global Search maps active modules to canonical detail pointers", async () => {
  const repository = new FakeRepository();
  repository.rows = [
    row({
      entityType: "diary",
      entityId: DIARY_ID,
    }),
    row({
      entityType: "todo",
      entityId: TODO_ID,
      stableName: "2026-08-01 C entry",
      timeBasis: "todo_date",
      businessDate: "2026-08-01",
    }),
    row({
      entityType: "universe",
      entityId: "node-1",
      stableName: "Universe node",
      timeBasis: "updated_at",
      author: null,
    }),
  ];

  const result = await new GlobalSearchService(
    repository,
  ).search({
    userId: USER_ID,
    query: "计划",
    modules: [
      "diary",
      "todo",
      "universe",
    ],
    limit: 10,
  });

  assert.equal(
    result.results[0]?.detail_tool,
    "get_diary",
  );
  assert.deepEqual(
    result.results[0]?.detail_arguments,
    {
      id: DIARY_ID,
      scope: "active",
    },
  );

  assert.equal(
    result.results[1]?.detail_tool,
    "read_todo_day",
  );
  assert.deepEqual(
    result.results[1]?.detail_arguments,
    { date: "2026-08-01" },
  );

  assert.equal(
    result.results[2]?.detail_tool,
    "get_universe_node",
  );
  assert.deepEqual(
    result.results[2]?.detail_arguments,
    { id: "node-1" },
  );

});

test("Global Search preserves cursor request binding", async () => {
  const repository = new FakeRepository();
  repository.rows = [
    row(),
    row({
      entityId:
        "00000000-0000-4000-8000-000000000005",
      businessTime:
        new Date("2026-07-31T00:00:00.000Z"),
      updatedAt:
        new Date("2026-07-31T00:00:00.000Z"),
    }),
  ];
  const service =
    new GlobalSearchService(repository);

  const first = await service.search({
    userId: USER_ID,
    query: "计划",
    modules: ["diary"],
    limit: 1,
  });
  assert.ok(first.metadata.next_cursor);

  await service.search({
    userId: USER_ID,
    query: "计划",
    modules: ["diary"],
    limit: 1,
    cursor:
      first.metadata.next_cursor ?? undefined,
  });

  await assert.rejects(
    service.search({
      userId: USER_ID,
      query: "different",
      modules: ["diary"],
      limit: 1,
      cursor:
        first.metadata.next_cursor ?? undefined,
    }),
    /invalid/i,
  );
});

test("MCP global_search exposes only active search modules", async (t) => {
  const calls: unknown[] = [];
  const result: GlobalSearchResult = {
    results: [{
      entity_type: "diary",
      entity_id: DIARY_ID,
      stable_name: "Diary",
      snippet: "计划",
      matched_field: "content",
      match_reason: "field_match",
      lifecycle_status: "active",
      business_time:
        "2026-08-01T00:00:00.000Z",
      time_basis: "diary_date",
      updated_at:
        "2026-08-01T00:00:00.000Z",
      author: "C",
      detail_tool: "get_diary",
      detail_arguments: {
        id: DIARY_ID,
        scope: "active",
      },
    }],
    metadata: {
      count: 1,
      has_more: false,
      next_cursor: null,
      searched_modules: ["diary"],
      searched_scope: "active",
      searched_author: null,
    },
  };

  const server = new McpServer({
    name: "global-search-test",
    version: "1",
  });
  registerGlobalSearchTool(server, {
    globalSearchService: {
      async search(input) {
        calls.push(input);
        return result;
      },
    },
    getAuthenticatedUserId: () => USER_ID,
  });

  const client = new Client(
    {
      name: "global-search-test",
      version: "1",
    },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const ok = await client.callTool({
    name: "global_search",
    arguments: {
      query: "计划",
      modules: ["diary"],
      author: "G",
    },
  });
  assert.equal(ok.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal((calls[0] as { author?: string }).author, "G");

  const retired = await client.callTool({
    name: "global_search",
    arguments: {
      query: "计划",
      modules: ["memory"],
    },
  });
  assert.equal(retired.isError, true);
});
