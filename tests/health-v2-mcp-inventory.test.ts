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

test("device Health and time tools are present once in public and internal MCP", async () => {
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
  assert.equal(internalNames.filter((name) => name === "get_health").length, 1);
  assert.equal(publicNames.filter((name) => name === "get_current_time").length, 1);
  assert.equal(internalNames.filter((name) => name === "get_current_time").length, 1);
  for (const ui of ["render_note_card"]) {
    assert.equal(publicNames.includes(ui), true);
    assert.equal(internalNames.includes(ui), false);
  }
  assert.deepEqual(
    publicNames.filter((name) =>
      name !== "render_thinking_block" && name !== "render_note_card"
    ),
    internalNames.filter((name) => !name.includes("notion")),
  );
});
