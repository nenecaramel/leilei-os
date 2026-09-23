import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerNotionTypedWriteTools,
  type NotionTypedWriteServiceContract,
} from "../src/mcp/server/register-notion-typed-writes.js";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const COMMENT_ID = "22222222-2222-4222-8222-222222222222";
const DISCUSSION_ID = "33333333-3333-4333-8333-333333333333";

async function connect() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const result = (operation: string, targetId: string, discussionId?: string) => ({
    operation,
    target_id: targetId,
    verified: true as const,
    ...(discussionId ? { discussion_id: discussionId } : {}),
  });
  const service: NotionTypedWriteServiceContract = {
    async createPage(body) {
      calls.push({ method: "createPage", args: [body] });
      return result("page.create", PAGE_ID);
    },
    async updatePage(pageId, body) {
      calls.push({ method: "updatePage", args: [pageId, body] });
      return result("page.update", pageId);
    },
    async updatePageContent(pageId, body) {
      calls.push({ method: "updatePageContent", args: [pageId, body] });
      return result("page.update_content", pageId);
    },
    async createComment(pageId, body) {
      calls.push({ method: "createComment", args: [pageId, body] });
      return result("comment.create", COMMENT_ID, DISCUSSION_ID);
    },
    async replyComment(pageId, discussionId, body) {
      calls.push({ method: "replyComment", args: [pageId, discussionId, body] });
      return result("comment.reply", COMMENT_ID, discussionId);
    },
  };

  const server = new McpServer({
    name: "notion-typed-write-test",
    version: "1.0.0",
  });
  registerNotionTypedWriteTools(server, {
    notionService: service,
    getAuthenticatedUserId: () =>
      "00000000-0000-4000-8000-000000000099",
  });
  const client = new Client(
    { name: "notion-typed-write-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls };
}

test("typed Notion facade exposes intent-specific tools without action/body wrappers", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tools = (await fixture.client.listTools()).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      "add_notion_comment",
      "append_notion_page_content",
      "create_notion_page",
      "replace_notion_page_content",
      "reply_notion_comment",
      "update_notion_page_properties",
    ],
  );
  for (const tool of tools) {
    const properties =
      (tool.inputSchema as { properties?: Record<string, unknown> }).properties
      ?? {};
    assert.equal("action" in properties, false);
    assert.equal("body" in properties, false);

    const dataProperties = (tool.outputSchema as {
      properties?: {
        data?: {
          properties?: Record<string, unknown>;
        };
      };
    }).properties?.data?.properties;
    assert.ok(dataProperties, `${tool.name} must expose structured mutation data`);
    for (const field of [
      "outcome",
      "entity_type",
      "entity_id",
      "revision",
      "detail_tool",
      "detail_arguments",
    ]) {
      assert.ok(field in dataProperties, `${tool.name} must expose ${field}`);
    }
  }
  assert.equal(
    tools.find((tool) => tool.name === "replace_notion_page_content")
      ?.annotations?.destructiveHint,
    true,
  );
});

test("create_notion_page maps typed parent/title/properties to provider payload", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const response = await fixture.client.callTool({
    name: "create_notion_page",
    arguments: {
      parent: { type: "data_source", id: "data-source-1" },
      title: "Typed page",
      title_property: "Name",
      properties: [
        { name: "Done", type: "checkbox", value: true },
        { name: "Priority", type: "select", value: "High" },
        { name: "Score", type: "number", value: 7 },
      ],
    },
  });

  assert.equal(response.isError, undefined);
  assert.deepEqual(fixture.calls, [{
    method: "createPage",
    args: [{
      parent: { type: "data_source_id", data_source_id: "data-source-1" },
      properties: {
        Name: {
          title: [{
            type: "text",
            text: { content: "Typed page" },
          }],
        },
        Done: { checkbox: true },
        Priority: { select: { name: "High" } },
        Score: { number: 7 },
      },
    }],
  }]);
  const receipt = (response.structuredContent as {
    data: {
      outcome: string;
      entity_type: string;
      entity_id: string;
      revision: number | null;
      detail_tool: string | null;
      detail_arguments: unknown;
    };
  }).data;
  assert.equal(receipt.outcome, "applied");
  assert.equal(receipt.entity_type, "notion_page");
  assert.equal(receipt.entity_id, PAGE_ID);
  assert.equal(receipt.revision, null);
  assert.equal(receipt.detail_tool, "read_notion_page");
  assert.deepEqual(receipt.detail_arguments, { page_id: PAGE_ID });
});

test("create_notion_page rejects a second typed title property before provider mutation", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const response = await fixture.client.callTool({
    name: "create_notion_page",
    arguments: {
      parent: { type: "page", id: PAGE_ID },
      title: "Primary title",
      properties: [
        { name: "Other Title", type: "title", value: "ambiguous" },
      ],
    },
  });

  assert.equal(response.isError, true);
  assert.match(JSON.stringify(response), /do not add another title property/i);
  assert.equal(fixture.calls.length, 0);
});

test("update_notion_page_properties maps typed values and rejects duplicate names", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const updated = await fixture.client.callTool({
    name: "update_notion_page_properties",
    arguments: {
      page_id: PAGE_ID,
      properties: [
        {
          name: "Window",
          type: "date",
          value: {
            start: "2026-09-23",
            end: "2026-09-24",
            time_zone: "Asia/Shanghai",
          },
        },
        {
          name: "Tags",
          type: "multi_select",
          value: ["MCP", "Notion"],
        },
        {
          name: "Links",
          type: "relation",
          value: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        },
      ],
    },
  });
  assert.equal(updated.isError, undefined);
  assert.deepEqual(fixture.calls[0], {
    method: "updatePage",
    args: [
      PAGE_ID,
      {
        properties: {
          Window: {
            date: {
              start: "2026-09-23",
              end: "2026-09-24",
              time_zone: "Asia/Shanghai",
            },
          },
          Tags: {
            multi_select: [{ name: "MCP" }, { name: "Notion" }],
          },
          Links: {
            relation: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
          },
        },
      },
    ],
  });

  const duplicate = await fixture.client.callTool({
    name: "update_notion_page_properties",
    arguments: {
      page_id: PAGE_ID,
      properties: [
        { name: "Done", type: "checkbox", value: true },
        { name: "Done", type: "checkbox", value: false },
      ],
    },
  });
  assert.equal(duplicate.isError, true);
  assert.match(JSON.stringify(duplicate), /supplied more than once/i);
  assert.equal(fixture.calls.length, 1);
});

test("typed content tools map append and replace to enhanced Markdown operations", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  await fixture.client.callTool({
    name: "append_notion_page_content",
    arguments: { page_id: PAGE_ID, markdown: "## Next\nbody" },
  });
  await fixture.client.callTool({
    name: "replace_notion_page_content",
    arguments: { page_id: PAGE_ID, markdown: "# New body" },
  });

  assert.deepEqual(fixture.calls, [
    {
      method: "updatePageContent",
      args: [
        PAGE_ID,
        {
          type: "insert_content",
          insert_content: { content: "## Next\nbody" },
        },
      ],
    },
    {
      method: "updatePageContent",
      args: [
        PAGE_ID,
        {
          type: "replace_content",
          replace_content: { new_str: "# New body" },
        },
      ],
    },
  ]);
});

test("typed comment tools build rich_text and route replies explicitly", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  await fixture.client.callTool({
    name: "add_notion_comment",
    arguments: { page_id: PAGE_ID, text: "  hello  " },
  });
  await fixture.client.callTool({
    name: "reply_notion_comment",
    arguments: {
      page_id: PAGE_ID,
      discussion_id: DISCUSSION_ID,
      text: "reply",
    },
  });

  assert.deepEqual(fixture.calls, [
    {
      method: "createComment",
      args: [
        PAGE_ID,
        {
          rich_text: [{
            type: "text",
            text: { content: "hello" },
          }],
        },
      ],
    },
    {
      method: "replyComment",
      args: [
        PAGE_ID,
        DISCUSSION_ID,
        {
          rich_text: [{
            type: "text",
            text: { content: "reply" },
          }],
        },
      ],
    },
  ]);
});
