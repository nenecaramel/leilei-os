import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { NotionJsonObject } from "../src/domains/notion/notion-transport.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { registerNotionWriteTools } from "../src/mcp/server/register-notion-writes.js";

async function connect() {
  const calls: Array<{ name: string; id?: string; body?: NotionJsonObject }> = [];
  const notionService = new Proxy({}, {
    get(_target, property) {
      if (property === "updatePage") {
        return async (id: string, body: NotionJsonObject) => {
          calls.push({ name: "updatePage", id, body });
          return { object: "page", id };
        };
      }
      return async () => ({ object: "result", id: "noop" });
    },
  }) as never;

  const server = createMcpServer();
  registerNotionWriteTools(server, {
    notionService,
    getAuthenticatedUserId: () => "00000000-0000-4000-8000-000000000099",
  });
  const client = new Client(
    { name: "notion-write-server-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls };
}

const WRITE_TOOLS = [
  "write_notion_page",
  "write_notion_block",
  "write_notion_database",
  "write_notion_data_source",
  "write_notion_view",
  "write_notion_comment",
  "upload_notion_file",
];

test("Notion registrar composes seven supported write tools with existing read tools", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const listed = await fixture.client.listTools();
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const name of ["search_notion", "read_notion_page", ...WRITE_TOOLS]) {
    assert.equal(names.has(name), true, `${name} should be registered`);
  }
  assert.equal(names.has("create_notion_meeting_note"), false);
});

test("Notion registrar routes a page update through injected dependencies", async (t) => {
  const fixture = await connect();
  t.after(async () => { await fixture.client.close(); await fixture.server.close(); });

  const body = { properties: { title: { title: [] } } };
  const result = await fixture.client.callTool({
    name: "write_notion_page",
    arguments: { action: "update", page_id: "page-id", body },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(fixture.calls, [{ name: "updatePage", id: "page-id", body }]);
});
