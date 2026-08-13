import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNotionWriteTools } from "../src/mcp/server/register-notion-writes.js";

const noopService = new Proxy({}, {
  get: () => async () => ({ object: "result", id: "noop" }),
}) as never;

const WRITE_TOOL_EXPECTED_FIELDS = new Map<string, string>([
  ["write_notion_page", "action"],
  ["write_notion_block", "action"],
  ["write_notion_database", "action"],
  ["write_notion_data_source", "action"],
  ["write_notion_view", "action"],
  ["write_notion_comment", "action"],
  ["upload_notion_file", "action"],
  ["create_notion_meeting_note", "body"],
]);

test("production Notion write registrar exposes usable top-level input fields through tools/list", async (t) => {
  const server = new McpServer({ name: "notion-schema-surface-test", version: "1.0.0" });
  registerNotionWriteTools(server, {
    notionService: noopService,
    getAuthenticatedUserId: () => "00000000-0000-4000-8000-000000000099",
  });

  const client = new Client(
    { name: "notion-schema-surface-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const listed = await client.listTools();

  for (const [name, expectedField] of WRITE_TOOL_EXPECTED_FIELDS) {
    const tool = listed.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    assert.ok(
      expectedField in properties,
      `${name} should expose ${expectedField} in tools/list, got ${JSON.stringify(tool.inputSchema)}`,
    );
  }
});
