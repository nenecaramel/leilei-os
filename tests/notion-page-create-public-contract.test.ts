import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { NotionJsonObject } from "../src/domains/notion/notion-transport.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { registerNotionWriteTools } from "../src/mcp/server/register-notion-writes.js";

test("page create accepts the public top-level parent field", async (t) => {
  const pageBodies: NotionJsonObject[] = [];
  const notionService = new Proxy({}, {
    get(_target, property) {
      if (property === "createPage") {
        return async (body: NotionJsonObject) => {
          pageBodies.push(body);
          return { object: "page", id: "page-id" };
        };
      }
      return async () => ({ object: "result", id: "unused" });
    },
  }) as never;

  const server = createMcpServer();
  registerNotionWriteTools(server, {
    notionService,
    getAuthenticatedUserId: () => "00000000-0000-4000-8000-000000000099",
  });
  const client = new Client(
    { name: "notion-page-create-contract", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });

  const parent = { type: "workspace", workspace: true };
  const body = {
    properties: {
      title: {
        title: [{ type: "text", text: { content: "Smoke" } }],
      },
    },
  };

  const result = await client.callTool({
    name: "write_notion_page",
    arguments: { action: "create", parent, body },
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(pageBodies, [{ ...body, parent }]);
});
