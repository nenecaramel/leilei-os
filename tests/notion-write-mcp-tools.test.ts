import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotionJsonObject } from "../src/domains/notion/notion-transport.js";
import { registerWriteNotionPageTool } from "../src/mcp/tools/write-notion-page/register.js";
import { registerWriteNotionBlockTool } from "../src/mcp/tools/write-notion-block/register.js";
import { registerWriteNotionDatabaseTool } from "../src/mcp/tools/write-notion-database/register.js";
import { registerWriteNotionDataSourceTool } from "../src/mcp/tools/write-notion-data-source/register.js";
import { registerWriteNotionViewTool } from "../src/mcp/tools/write-notion-view/register.js";
import { registerWriteNotionCommentTool } from "../src/mcp/tools/write-notion-comment/register.js";
import { registerUploadNotionFileTool } from "../src/mcp/tools/upload-notion-file/register.js";
import { NotionWriteAuthenticationError } from "../src/mcp/tools/notion-write-shared.js";

class NotionWrites {
  calls: Array<{ method: string; args: unknown[] }> = [];

  private result(method: string, args: unknown[]): Promise<NotionJsonObject> {
    this.calls.push({ method, args });
    return Promise.resolve({ object: "result", id: `${method}-id` });
  }

  createPage(body: NotionJsonObject) { return this.result("createPage", [body]); }
  updatePage(id: string, body: NotionJsonObject) { return this.result("updatePage", [id, body]); }
  movePage(id: string, parent: NotionJsonObject) { return this.result("movePage", [id, parent]); }
  updatePageMarkdown(id: string, body: NotionJsonObject) { return this.result("updatePageMarkdown", [id, body]); }
  appendBlockChildren(id: string, body: NotionJsonObject) { return this.result("appendBlockChildren", [id, body]); }
  updateBlock(id: string, body: NotionJsonObject) { return this.result("updateBlock", [id, body]); }
  deleteBlock(id: string) { return this.result("deleteBlock", [id]); }
  createDatabase(body: NotionJsonObject) { return this.result("createDatabase", [body]); }
  updateDatabase(id: string, body: NotionJsonObject) { return this.result("updateDatabase", [id, body]); }
  createDataSource(body: NotionJsonObject) { return this.result("createDataSource", [body]); }
  updateDataSource(id: string, body: NotionJsonObject) { return this.result("updateDataSource", [id, body]); }
  createView(body: NotionJsonObject) { return this.result("createView", [body]); }
  updateView(id: string, body: NotionJsonObject) { return this.result("updateView", [id, body]); }
  deleteView(id: string) { return this.result("deleteView", [id]); }
  createComment(body: NotionJsonObject) { return this.result("createComment", [body]); }
  updateComment(id: string, body: NotionJsonObject) { return this.result("updateComment", [id, body]); }
  deleteComment(id: string) { return this.result("deleteComment", [id]); }
  createUpload(body: NotionJsonObject) { return this.result("createUpload", [body]); }
  sendUpload(id: string, file: Blob, filename: string, partNumber?: number) {
    return this.result("sendUpload", [id, file.size, file.type, filename, partNumber]);
  }
  completeUpload(id: string) { return this.result("completeUpload", [id]); }
}

async function connect(authenticated = true) {
  const writes = new NotionWrites();
  let authCalls = 0;
  const auth = () => {
    authCalls += 1;
    if (!authenticated) throw new NotionWriteAuthenticationError();
    return "00000000-0000-4000-8000-000000000099";
  };
  const server = new McpServer({ name: "notion-write-test", version: "1.0.0" });

  registerWriteNotionPageTool(server, { notionService: writes, getAuthenticatedUserId: auth });
  registerWriteNotionBlockTool(server, { notionService: writes, getAuthenticatedUserId: auth });
  registerWriteNotionDatabaseTool(server, { notionService: writes, getAuthenticatedUserId: auth });
  registerWriteNotionDataSourceTool(server, { notionService: writes, getAuthenticatedUserId: auth });
  registerWriteNotionViewTool(server, { notionService: writes, getAuthenticatedUserId: auth });
  registerWriteNotionCommentTool(server, { notionService: writes, getAuthenticatedUserId: auth });
  registerUploadNotionFileTool(server, { notionService: writes, getAuthenticatedUserId: auth });

  const client = new Client(
    { name: "notion-write-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, writes, get authCalls() { return authCalls; } };
}

const WRITE_TOOLS = [
  "write_notion_page",
  "write_notion_block",
  "write_notion_database",
  "write_notion_data_source",
  "write_notion_view",
  "write_notion_comment",
  "upload_notion_file",
] as const;

test("all Notion write tools are registered as open-world mutations without secret or confirm inputs", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });
  const listed = await fixture.client.listTools();

  for (const name of WRITE_TOOLS) {
    const tool = listed.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.equal(tool.annotations?.readOnlyHint, false);
    assert.equal(tool.annotations?.openWorldHint, true);
    const serialized = JSON.stringify(tool.inputSchema);
    assert.equal(serialized.includes("NOTION_PAT"), false);
    assert.equal(serialized.includes('"token"'), false);
    assert.equal(serialized.includes('"confirm"'), false);
    assert.equal(serialized.includes('"user_id"'), false);
  }
});

test("page/block destructive actions execute immediately after authentication", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const page = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: { action: "trash", page_id: "page-id" },
  });
  const block = await fixture.client.callTool({
    name: "write_notion_block",
    arguments: {
      action: "insert_children",
      block_id: "block-id",
      body: { children: [], position: { type: "end" } },
    },
  });

  assert.equal(page.isError, undefined);
  assert.equal(block.isError, undefined);
  assert.equal(fixture.authCalls, 2);
  assert.deepEqual(fixture.writes.calls[0], {
    method: "updatePage",
    args: ["page-id", { in_trash: true }],
  });
  assert.deepEqual(fixture.writes.calls[1], {
    method: "appendBlockChildren",
    args: ["block-id", { children: [], position: { type: "end" } }],
  });
});

test("structure, comment, and upload tools dispatch action-specific payloads including permanent deletes", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  await fixture.client.callTool({ name: "write_notion_database", arguments: { action: "create", body: { parent: { type: "workspace", workspace: true } } } });
  await fixture.client.callTool({ name: "write_notion_data_source", arguments: { action: "trash", data_source_id: "source-id" } });
  await fixture.client.callTool({ name: "write_notion_view", arguments: { action: "delete", view_id: "view-id" } });
  await fixture.client.callTool({ name: "write_notion_comment", arguments: { action: "delete", comment_id: "comment-id" } });
  await fixture.client.callTool({ name: "upload_notion_file", arguments: { action: "send", file_upload_id: "upload-id", filename: "x.txt", content_type: "text/plain", file_base64: Buffer.from("hello").toString("base64"), part_number: 1 } });

  assert.deepEqual(fixture.writes.calls.map((call) => call.method), [
    "createDatabase",
    "updateDataSource",
    "deleteView",
    "deleteComment",
    "sendUpload",
  ]);
  assert.deepEqual(fixture.writes.calls[1]?.args, ["source-id", { in_trash: true }]);
  assert.deepEqual(fixture.writes.calls[2]?.args, ["view-id"]);
  assert.deepEqual(fixture.writes.calls[3]?.args, ["comment-id"]);
  assert.deepEqual(fixture.writes.calls[4]?.args, ["upload-id", 5, "text/plain", "x.txt", 1]);
});

test("strict schemas reject synthetic confirmation and secret injection before auth", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: {
      action: "trash",
      page_id: "page-id",
      confirm: true,
      token: "attacker",
    },
  });

  assert.equal(result.isError, true);
  assert.equal(fixture.authCalls, 0);
  assert.equal(fixture.writes.calls.length, 0);
});

test("missing MCP authentication stops writes before service access", async (t) => {
  const fixture = await connect(false);
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: { action: "trash", page_id: "page-id" },
  });

  assert.equal(result.isError, true);
  assert.equal(fixture.writes.calls.length, 0);
});
