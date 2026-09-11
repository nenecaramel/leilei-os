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
import { registerGlobalSearchTool } from "../src/mcp/tools/global-search/register.js";
import {
  createGlobalSearchLocation,
  readGlobalSearchFilters,
} from "../web/src/pages/global-search-location.js";
import {
  createGlobalSearchResultDetailLocation,
  GLOBAL_SEARCH_MODULE_LABELS,
  type GlobalSearchResult as WebGlobalSearchResult,
} from "../web/src/pages/global-search-result.js";
import {
  createSharedPaperDetailLocation,
  getSharedPaperDetailLocation,
  getSafeSharedPaperReturnTo,
} from "../web/src/pages/shared-paper-location.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PAPER_ID = "00000000-0000-4000-8000-000000000006";

const SHARED_PAPER_ROW: GlobalSearchRow = {
  entityType: "shared_paper",
  entityId: PAPER_ID,
  stableName: "浩荡",
  matchedField: "content",
  matchedValue: "这是 Shared Paper 正文里的浩荡。",
  matchReason: "field_match",
  lifecycleStatus: "archived",
  businessTime: new Date("2026-09-11T14:00:00.000Z"),
  timeBasis: "updated_at",
  updatedAt: new Date("2026-09-11T14:00:00.000Z"),
  rank: 4,
  author: "G",
};

class Repository implements GlobalSearchRepository {
  calls: GlobalSearchQuery[] = [];
  result: GlobalSearchRow[] = [SHARED_PAPER_ROW];

  async findUser() {
    return { status: "active" as const, timezone: "Asia/Shanghai" };
  }

  async search(input: GlobalSearchQuery) {
    this.calls.push(input);
    return this.result;
  }
}

test("Global Search treats Shared Paper as a first-class searchable module with get_shared_paper detail", async () => {
  const repository = new Repository();
  const service = new GlobalSearchService(repository);

  const result = await service.search({
    userId: USER_ID,
    query: "浩荡",
    modules: ["shared_paper"],
    scope: "archived",
  });

  assert.deepEqual(repository.calls[0]?.modules, ["shared_paper"]);
  assert.deepEqual(result.metadata.searched_modules, ["shared_paper"]);
  assert.deepEqual(result.results[0], {
    entity_type: "shared_paper",
    entity_id: PAPER_ID,
    stable_name: "浩荡",
    snippet: "这是 Shared Paper 正文里的浩荡。",
    matched_field: "content",
    match_reason: "field_match",
    lifecycle_status: "archived",
    business_time: "2026-09-11T14:00:00.000Z",
    time_basis: "updated_at",
    updated_at: "2026-09-11T14:00:00.000Z",
    author: "G",
    detail_tool: "get_shared_paper",
    detail_arguments: { id: PAPER_ID },
  });
});

test("Global Search defaults include Shared Paper without changing explicit module filtering", async () => {
  const repository = new Repository();
  const service = new GlobalSearchService(repository);

  await service.search({ userId: USER_ID, query: "浩荡" });
  assert.deepEqual(repository.calls[0]?.modules, [
    "memory",
    "diary",
    "task",
    "todo",
    "universe",
    "shared_paper",
  ]);

  await service.search({
    userId: USER_ID,
    query: "浩荡",
    modules: ["memory", "shared_paper"],
  });
  assert.deepEqual(repository.calls[1]?.modules, ["memory", "shared_paper"]);
});

test("global_search MCP schema accepts Shared Paper and returns its canonical detail pointer", async (t) => {
  const data: GlobalSearchResult = {
    results: [{
      entity_type: "shared_paper",
      entity_id: PAPER_ID,
      stable_name: "浩荡",
      snippet: "Shared Paper 浩荡",
      matched_field: "title",
      match_reason: "exact_stable_name",
      lifecycle_status: "active",
      business_time: "2026-09-11T14:00:00.000Z",
      time_basis: "updated_at",
      updated_at: "2026-09-11T14:00:00.000Z",
      author: "L",
      detail_tool: "get_shared_paper",
      detail_arguments: { id: PAPER_ID },
    }],
    metadata: {
      count: 1,
      has_more: false,
      next_cursor: null,
      searched_modules: ["shared_paper"],
      searched_scope: "active",
    },
  };

  const server = new McpServer({ name: "shared-paper-global-search", version: "1" });
  registerGlobalSearchTool(server, {
    globalSearchService: {
      async search(input) {
        assert.equal(input.userId, USER_ID);
        assert.deepEqual(input.modules, ["shared_paper"]);
        return data;
      },
    },
    getAuthenticatedUserId: () => USER_ID,
  });

  const client = new Client({ name: "shared-paper-global-search-client", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tool = (await client.listTools()).tools.find((candidate) => candidate.name === "global_search");
  assert.ok(tool);
  assert.match(JSON.stringify(tool.inputSchema), /shared_paper/);
  assert.match(JSON.stringify(tool.outputSchema), /get_shared_paper/);

  const response = await client.callTool({
    name: "global_search",
    arguments: { query: "浩荡", modules: ["shared_paper"] },
  });
  assert.equal(response.isError, undefined);
  assert.deepEqual(response.structuredContent, { success: true, data });
});

test("Global Search Web URLs preserve Shared Paper module and open exact active or archived paper", () => {
  assert.deepEqual(
    readGlobalSearchFilters("?q=%E6%B5%A9%E8%8D%A1&modules=shared_paper&scope=all"),
    {
      q: "浩荡",
      modules: ["shared_paper"],
      scope: "all",
      mode: "normal",
      dateFrom: "",
      dateTo: "",
    },
  );
  assert.equal(
    createGlobalSearchLocation({
      q: "浩荡",
      modules: ["shared_paper"],
      scope: "all",
      mode: "normal",
      dateFrom: "",
      dateTo: "",
    }),
    "/search?q=%E6%B5%A9%E8%8D%A1&modules=shared_paper&scope=all",
  );
  assert.equal(GLOBAL_SEARCH_MODULE_LABELS.shared_paper, "Shared Paper");

  const base: WebGlobalSearchResult = {
    entity_type: "shared_paper",
    entity_id: PAPER_ID,
    stable_name: "浩荡",
    snippet: "正文",
    matched_field: "content",
    match_reason: "field_match",
    lifecycle_status: "active",
    business_time: "2026-09-11T14:00:00.000Z",
    time_basis: "updated_at",
    updated_at: "2026-09-11T14:00:00.000Z",
    author: "G",
    detail_tool: "get_shared_paper",
    detail_arguments: { id: PAPER_ID },
  };

  const returnTo = "/search?q=%E6%B5%A9%E8%8D%A1&modules=shared_paper&scope=all";
  assert.equal(
    createGlobalSearchResultDetailLocation(base, returnTo),
    createSharedPaperDetailLocation(PAPER_ID, "active", returnTo),
  );
  assert.equal(
    createGlobalSearchResultDetailLocation({ ...base, lifecycle_status: "archived" }, returnTo),
    createSharedPaperDetailLocation(PAPER_ID, "archived", returnTo),
  );
});

test("Shared Paper deep links are UUID-scoped and only accept safe Global Search return targets", () => {
  const returnTo = "/search?q=%E6%B5%A9%E8%8D%A1&modules=shared_paper";
  const location = createSharedPaperDetailLocation(PAPER_ID, "archived", returnTo);
  const parsed = getSharedPaperDetailLocation(new URL(location, "https://leilei.test").search);

  assert.deepEqual(parsed, {
    paperId: PAPER_ID,
    scope: "archived",
    returnTo,
  });
  assert.equal(getSafeSharedPaperReturnTo("https://evil.test/search?q=x"), "/shared-paper");
  assert.equal(getSafeSharedPaperReturnTo(returnTo), returnTo);
  assert.equal(getSharedPaperDetailLocation("?paper=not-a-uuid&scope=archived").paperId, null);
});
