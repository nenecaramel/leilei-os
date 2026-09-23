import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerNotionExplicitWriteTools,
  type NotionExplicitWriteServiceContract,
} from "../src/mcp/server/register-notion-explicit-writes.js";

const PAGE_ID = "11111111-1111-4111-8111-111111111111";
const COMMENT_ID = "22222222-2222-4222-8222-222222222222";
const DISCUSSION_ID = "33333333-3333-4333-8333-333333333333";

async function connect() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const result = (operation: string, targetId: string) => ({
    operation,
    target_id: targetId,
    verified: true as const,
  });
  const service: NotionExplicitWriteServiceContract = {
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
      return result("comment.create", COMMENT_ID);
    },
    async replyComment(pageId, discussionId, body) {
      calls.push({ method: "replyComment", args: [pageId, discussionId, body] });
      return result("comment.reply", COMMENT_ID);
    },
  };

  const server = new McpServer({ name: "notion-explicit-write-test", version: "1.0.0" });
  registerNotionExplicitWriteTools(server, {
    notionService: service,
    getAuthenticatedUserId: () => "00000000-0000-4000-8000-000000000099",
  });
  const client = new Client(
    { name: "notion-explicit-write-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls };
}

function actionEnum(inputSchema: unknown): string[] {
  const schema = inputSchema as { properties?: { action?: { enum?: string[] } } };
  return schema.properties?.action?.enum ?? [];
}

test("Phase 8.6.2 registrar exposes only page and comment writes with frozen actions", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const listed = await fixture.client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    "write_notion_comment",
    "write_notion_page",
  ]);

  const page = listed.tools.find((tool) => tool.name === "write_notion_page");
  const comment = listed.tools.find((tool) => tool.name === "write_notion_comment");
  assert.ok(page);
  assert.ok(comment);
  assert.deepEqual(actionEnum(page.inputSchema), ["create", "update", "update_content"]);
  assert.deepEqual(actionEnum(comment.inputSchema), ["create", "reply"]);
  assert.equal(page.annotations?.destructiveHint, false);
  assert.equal(comment.annotations?.destructiveHint, false);
  for (const tool of [page, comment]) {
    const dataProperties = (tool.outputSchema as {
      properties?: {
        data?: {
          properties?: Record<string, unknown>;
        };
      };
    }).properties?.data?.properties;
    assert.ok(dataProperties);
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
});

test("write_notion_page exposed schema documents action-specific required and forbidden fields", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const listed = await fixture.client.listTools();
  const page = listed.tools.find((tool) => tool.name === "write_notion_page");
  assert.ok(page);
  const schema = page.inputSchema as {
    properties?: Record<string, { description?: string }>;
  };
  assert.match(schema.properties?.action?.description ?? "", /create\s+requires\s+body/i);
  assert.match(schema.properties?.page_id?.description ?? "", /required.*update.*update_content.*forbidden.*create/i);
  assert.match(schema.properties?.body?.description ?? "", /required.*create.*update.*update_content/i);
  assert.match(schema.properties?.parent?.description ?? "", /optional.*create.*only.*forbidden/i);
});

test("minimal registrar routes allowed page and comment actions only", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const pageBody = { properties: { Name: { title: [] } } };
  const pageResult = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: { action: "update", page_id: PAGE_ID, body: pageBody },
  });
  const commentResult = await fixture.client.callTool({
    name: "write_notion_comment",
    arguments: {
      action: "reply",
      page_id: PAGE_ID,
      discussion_id: DISCUSSION_ID,
      body: { rich_text: [{ type: "text", text: { content: "Reply" } }] },
    },
  });

  assert.equal(pageResult.isError, undefined);
  assert.equal(commentResult.isError, undefined);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["updatePage", "replyComment"]);
  const pageData = (pageResult.structuredContent as {
    data: {
      outcome: string;
      entity_type: string;
      entity_id: string;
      detail_tool: string | null;
      detail_arguments: unknown;
    };
  }).data;
  assert.equal(pageData.outcome, "applied");
  assert.equal(pageData.entity_type, "notion_page");
  assert.equal(pageData.entity_id, PAGE_ID);
  assert.equal(pageData.detail_tool, "read_notion_page");
  assert.deepEqual(pageData.detail_arguments, { page_id: PAGE_ID });

  const commentData = (commentResult.structuredContent as {
    data: {
      outcome: string;
      entity_type: string;
      detail_tool: string | null;
      detail_arguments: unknown;
    };
  }).data;
  assert.equal(commentData.outcome, "applied");
  assert.equal(commentData.entity_type, "notion_comment");
  assert.equal(commentData.detail_tool, null);
  assert.equal(commentData.detail_arguments, null);
});

test("destructive or non-native actions are rejected by the public tool schema", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const page = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: { action: "trash", page_id: PAGE_ID },
  });
  const comment = await fixture.client.callTool({
    name: "write_notion_comment",
    arguments: { action: "update", page_id: PAGE_ID, body: {} },
  });

  assert.equal(page.isError, true);
  assert.equal(comment.isError, true);
  assert.equal(fixture.calls.length, 0);
});

test("page action-specific schemas reject unknown create and parent fields before service calls", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const create = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: {
      action: "create",
      parent: { type: "workspace", workspace: true, unexpected: true },
      body: { properties: {}, unexpected: true },
    },
  });

  assert.equal(create.isError, true);
  assert.equal(fixture.calls.length, 0);
});

test("page action-specific schemas reject unknown update and content fields before service calls", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const update = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: {
      action: "update",
      page_id: PAGE_ID,
      body: { properties: {}, children: [] },
    },
  });
  const content = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: {
      action: "update_content",
      page_id: PAGE_ID,
      body: {
        type: "replace_content",
        replace_content: { new_str: "# After", unexpected: true },
      },
    },
  });

  assert.equal(update.isError, true);
  assert.equal(content.isError, true);
  assert.equal(fixture.calls.length, 0);
});
