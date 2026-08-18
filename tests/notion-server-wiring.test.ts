import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  NotionPageReadResult,
  NotionSearchInput,
  NotionSearchResult,
} from "../src/domains/notion/notion-read-client.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const PAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class NotionReads {
  searchCalls: NotionSearchInput[] = [];
  readCalls: string[] = [];

  async searchPages(input: NotionSearchInput): Promise<NotionSearchResult> {
    this.searchCalls.push(input);
    return {
      results: [{
        id: PAGE_ID,
        title: "主线规划",
        url: "https://www.notion.so/main",
        last_edited_time: "2026-08-13T08:00:00.000Z",
      }],
      metadata: { count: 1, has_more: false, next_cursor: null },
    };
  }

  async readPage(pageId: string): Promise<NotionPageReadResult> {
    this.readCalls.push(pageId);
    return {
      page: {
        id: PAGE_ID,
        title: "主线规划",
        url: "https://www.notion.so/main",
        last_edited_time: "2026-08-13T08:00:00.000Z",
      },
      content: "Phase 7",
      block_count: 1,
      truncated: false,
    };
  }
}

test("createMcpServer registers injected Notion reads behind authenticated user context", async (t) => {
  const notion = new NotionReads();
  let authCalls = 0;
  const server = createMcpServer({
    notionTools: {
      notionService: notion,
      getAuthenticatedUserId: () => {
        authCalls += 1;
        return USER_ID;
      },
    },
  });
  const client = new Client(
    { name: "notion-server-wiring", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = await client.listTools();
  for (const name of ["search_notion", "read_notion_page"]) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered by createMcpServer`);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  }

  const search = await client.callTool({
    name: "search_notion",
    arguments: { query: "主线规划" },
  });
  const read = await client.callTool({
    name: "read_notion_page",
    arguments: { page_id: PAGE_ID },
  });

  assert.equal(search.isError, undefined);
  assert.equal(read.isError, undefined);
  assert.equal(authCalls, 2);
  assert.deepEqual(notion.searchCalls, [{ query: "主线规划" }]);
  assert.deepEqual(notion.readCalls, [PAGE_ID]);
});
