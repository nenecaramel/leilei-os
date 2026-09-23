import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  NotionReadError,
  type NotionPageReadResult,
  type NotionSearchInput,
  type NotionSearchResult,
} from "../src/domains/notion/notion-read-client.js";
import {
  registerSearchNotionTool,
  SearchNotionAuthenticationError,
} from "../src/mcp/tools/search-notion/register.js";
import {
  ReadNotionPageAuthenticationError,
  registerReadNotionPageTool,
} from "../src/mcp/tools/read-notion-page/register.js";

const PAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

class NotionReads {
  searchCalls: NotionSearchInput[] = [];
  readCalls: string[] = [];
  searchError: Error | undefined;
  readError: Error | undefined;

  async searchPages(input: NotionSearchInput): Promise<NotionSearchResult> {
    this.searchCalls.push(input);
    if (this.searchError) throw this.searchError;
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
    if (this.readError) throw this.readError;
    return {
      page: {
        id: PAGE_ID,
        title: "主线规划",
        url: "https://www.notion.so/main",
        last_edited_time: "2026-08-13T08:00:00.000Z",
      },
      content: "# 主线规划\nPhase 7",
      block_count: 2,
      truncated: false,
    };
  }
}

async function connect(options?: { authenticated?: boolean }) {
  const notion = new NotionReads();
  let authCalls = 0;
  const server = new McpServer({ name: "notion-tools-test", version: "1.0.0" });
  const getAuthenticatedUserId = () => {
    authCalls += 1;
    if (options?.authenticated === false) {
      throw new SearchNotionAuthenticationError();
    }
    return "00000000-0000-4000-8000-000000000099";
  };

  registerSearchNotionTool(server, { notionService: notion, getAuthenticatedUserId });
  registerReadNotionPageTool(server, {
    notionService: notion,
    getAuthenticatedUserId: () => {
      authCalls += 1;
      if (options?.authenticated === false) {
        throw new ReadNotionPageAuthenticationError();
      }
      return "00000000-0000-4000-8000-000000000099";
    },
  });

  const client = new Client(
    { name: "notion-tools-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, notion, get authCalls() { return authCalls; } };
}

test("Notion MCP tools are strict read-only open-world tools", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const listed = await fixture.client.listTools();
  for (const name of ["search_notion", "read_notion_page"]) {
    const tool = listed.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("token" in (tool.inputSchema.properties ?? {}), false);
  }
});

test("search_notion authenticates first and returns structured page discovery", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const result = await fixture.client.callTool({
    name: "search_notion",
    arguments: { query: "主线规划", limit: 7, cursor: "cursor-1" },
  });

  assert.equal(result.isError, undefined);
  assert.equal(fixture.authCalls, 1);
  assert.deepEqual(fixture.notion.searchCalls, [{
    query: "主线规划",
    limit: 7,
    cursor: "cursor-1",
  }]);
  assert.deepEqual(result.structuredContent, {
    success: true,
    data: {
      results: [{
        id: PAGE_ID,
        title: "主线规划",
        url: "https://www.notion.so/main",
        last_edited_time: "2026-08-13T08:00:00.000Z",
        detail_tool: "read_notion_page",
        detail_arguments: { page_id: PAGE_ID },
      }],
      metadata: { count: 1, has_more: false, next_cursor: null },
    },
  });
});

test("read_notion_page authenticates first and returns bounded page content", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const result = await fixture.client.callTool({
    name: "read_notion_page",
    arguments: { page_id: PAGE_ID },
  });

  assert.equal(result.isError, undefined);
  assert.equal(fixture.authCalls, 1);
  assert.deepEqual(fixture.notion.readCalls, [PAGE_ID]);
  assert.deepEqual(result.structuredContent, {
    success: true,
    data: {
      page: {
        id: PAGE_ID,
        title: "主线规划",
        url: "https://www.notion.so/main",
        last_edited_time: "2026-08-13T08:00:00.000Z",
      },
      content: "# 主线规划\nPhase 7",
      block_count: 2,
      truncated: false,
      content_metadata: {
        returned_chars: Array.from("# 主线规划\nPhase 7").length,
        total_chars: Array.from("# 主线规划\nPhase 7").length,
        truncated: false,
        next_cursor: null,
      },
    },
  });
});

test("read_notion_page accepts an official Notion URL as an exact page reference", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const result = await fixture.client.callTool({
    name: "read_notion_page",
    arguments: { page_url: `https://www.notion.so/Project-${PAGE_ID.replaceAll("-", "")}` },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(fixture.notion.readCalls, [PAGE_ID]);
});

test("strict schemas reject client identity and secret injection", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const search = await fixture.client.callTool({
    name: "search_notion",
    arguments: { query: "x", user_id: "attacker", token: "attacker-token" },
  });
  const read = await fixture.client.callTool({
    name: "read_notion_page",
    arguments: { page_id: PAGE_ID, user_id: "attacker" },
  });

  assert.equal(search.isError, true);
  assert.equal(read.isError, true);
  assert.equal(fixture.authCalls, 0);
  assert.equal(fixture.notion.searchCalls.length, 0);
  assert.equal(fixture.notion.readCalls.length, 0);
});

test("Notion upstream errors are mapped without leaking service error text", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  fixture.notion.searchError = new NotionReadError(
    "ACCESS_DENIED",
    "sensitive upstream details",
  );
  fixture.notion.readError = new NotionReadError(
    "NOT_FOUND",
    "sensitive page details",
  );

  const search = await fixture.client.callTool({
    name: "search_notion",
    arguments: { query: "x" },
  });
  const read = await fixture.client.callTool({
    name: "read_notion_page",
    arguments: { page_id: PAGE_ID },
  });

  assert.equal(search.isError, true);
  assert.equal(read.isError, true);
  const text = JSON.stringify([search.content, read.content]);
  assert.equal(text.includes("sensitive upstream details"), false);
  assert.equal(text.includes("sensitive page details"), false);
  assert.match(text, /Notion access is unavailable/);
  assert.match(text, /not found or is not accessible/i);
});

test("Notion tools fail before service access when MCP authentication is missing", async (t) => {
  const fixture = await connect({ authenticated: false });
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const search = await fixture.client.callTool({
    name: "search_notion",
    arguments: { query: "x" },
  });
  const read = await fixture.client.callTool({
    name: "read_notion_page",
    arguments: { page_id: PAGE_ID },
  });

  assert.equal(search.isError, true);
  assert.equal(read.isError, true);
  assert.equal(fixture.notion.searchCalls.length, 0);
  assert.equal(fixture.notion.readCalls.length, 0);
});
