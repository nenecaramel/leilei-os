import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReadNotionPageTool } from "../src/mcp/tools/read-notion-page/register.js";

const noopReadService = {
  async readPage(): Promise<never> {
    throw new Error("not used");
  },
};

test("read_notion_page exposes page reference fields through tools/list", async (t) => {
  const server = new McpServer({ name: "notion-read-schema-surface-test", version: "1.0.0" });
  registerReadNotionPageTool(server, {
    notionService: noopReadService,
    getAuthenticatedUserId: () => "00000000-0000-4000-8000-000000000099",
  });

  const client = new Client(
    { name: "notion-read-schema-surface-client", version: "1.0.0" },
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
  const tool = listed.tools.find((candidate) => candidate.name === "read_notion_page");
  assert.ok(tool, "read_notion_page should be registered");

  const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
  assert.ok(
    "page_id" in properties,
    `read_notion_page should expose page_id in tools/list, got ${JSON.stringify(tool.inputSchema)}`,
  );
  assert.ok(
    "page_url" in properties,
    `read_notion_page should expose page_url in tools/list, got ${JSON.stringify(tool.inputSchema)}`,
  );
  assert.ok("max_chars" in properties);
  assert.ok("cursor" in properties);
  assert.equal(
    (properties.max_chars as { default?: number }).default,
    12_000,
  );
});
