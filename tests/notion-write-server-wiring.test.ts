import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { NotionJsonObject } from "../src/domains/notion/notion-transport.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { registerNotionWriteTools } from "../src/mcp/server/register-notion-writes.js";

class NotionWrites {
  calls: string[] = [];
  private result(name: string): Promise<NotionJsonObject> {
    this.calls.push(name);
    return Promise.resolve({ object: "result", id: `${name}-id` });
  }
  createPage(_body: NotionJsonObject) { return this.result("createPage"); }
  updatePage(_id: string, _body: NotionJsonObject) { return this.result("updatePage"); }
  movePage(_id: string, _parent: NotionJsonObject) { return this.result("movePage"); }
  updatePageMarkdown(_id: string, _body: NotionJsonObject) { return this.result("updatePageMarkdown"); }
  appendBlockChildren(_id: string, _body: NotionJsonObject) { return this.result("appendBlockChildren"); }
  updateBlock(_id: string, _body: NotionJsonObject) { return this.result("updateBlock"); }
  deleteBlock(_id: string) { return this.result("deleteBlock"); }
  createDatabase(_body: NotionJsonObject) { return this.result("createDatabase"); }
  updateDatabase(_id: string, _body: NotionJsonObject) { return this.result("updateDatabase"); }
  createDataSource(_body: NotionJsonObject) { return this.result("createDataSource"); }
  updateDataSource(_id: string, _body: NotionJsonObject) { return this.result("updateDataSource"); }
  createView(_body: NotionJsonObject) { return this.result("createView"); }
  updateView(_id: string, _body: NotionJsonObject) { return this.result("updateView"); }
  deleteView(_id: string) { return this.result("deleteView"); }
  createComment(_body: NotionJsonObject) { return this.result("createComment"); }
  updateComment(_id: string, _body: NotionJsonObject) { return this.result("updateComment"); }
  deleteComment(_id: string) { return this.result("deleteComment"); }
  createUpload(_body: NotionJsonObject) { return this.result("createUpload"); }
  sendUpload(_id: string, _file: Blob, _filename: string, _partNumber?: number) { return this.result("sendUpload"); }
  completeUpload(_id: string) { return this.result("completeUpload"); }
  createMeetingNote(_body: NotionJsonObject) { return this.result("createMeetingNote"); }
}

async function connect() {
  const writes = new NotionWrites();
  const server = createMcpServer();
  registerNotionWriteTools(server, {
    notionService: writes,
    getAuthenticatedUserId: () => "00000000-0000-4000-8000-000000000099",
  });
  const client = new Client(
    { name: "notion-write-server-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, writes };
}

const WRITE_TOOLS = [
  "write_notion_page",
  "write_notion_block",
  "write_notion_database",
  "write_notion_data_source",
  "write_notion_view",
  "write_notion_comment",
  "upload_notion_file",
  "create_notion_meeting_note",
];

test("Notion write registrar composes eight write tools with existing read tools", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const listed = await fixture.client.listTools();
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const name of ["search_notion", "read_notion_page", ...WRITE_TOOLS]) {
    assert.equal(names.has(name), true, `${name} should be registered`);
  }
});

test("Notion write registrar routes execution through injected write dependencies", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const result = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: { action: "trash", page_id: "page-id" },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(fixture.writes.calls, ["updatePage"]);
});
