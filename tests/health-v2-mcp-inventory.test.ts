import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProductionMcpSessionServerFactory } from "../src/mcp/server/production-server-factory.js";

async function listTools(server: McpServer, clientName: string): Promise<string[]> {
  const client = new Client({ name: clientName, version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

test("Health v2 adds get_health exactly once to public MCP and never internal MCP", async () => {
  const createSessionServer = createProductionMcpSessionServerFactory({
    activeUserRepository: { findUserById: async () => ({ status: "active" }) },
    memoryService: {} as never,
    diaryService: {} as never,
    taskService: {} as never,
    toyCommandService: {} as never,
    globalSearchService: {} as never,
    todoService: {} as never,
    universeService: {} as never,
    healthService: {
      readDay: async () => null,
      readRecent: async () => [],
    } as never,
  });

  const publicNames = await listTools(createSessionServer("user-1", "public"), "health-public");
  const internalNames = await listTools(createSessionServer("user-1", "internal"), "health-internal");

  assert.equal(publicNames.filter((name) => name === "get_health").length, 1);
  assert.equal(internalNames.includes("get_health"), false);
  assert.deepEqual(
    publicNames.filter((name) => name !== "get_health" && name !== "render_thinking_block"),
    internalNames,
  );
});
