import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createProductionMcpSessionServerFactory } from "../src/mcp/server/production-server-factory.js";

test("bridge listener tool surface is model/app split", async () => {
  const server = createProductionMcpSessionServerFactory({
    activeUserRepository: { findUserById: async () => ({ status: "active" }) },
    memoryService: {} as never, diaryService: {} as never, taskService: {} as never,
    toyCommandService: {} as never, globalSearchService: {} as never, todoService: {} as never,
    universeService: {} as never,
    healthService: {} as never,
    bridgeService: {} as never,
  })("user-1", "public");
  const client = new Client({ name: "bridge-test", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.ok(names.includes("bridge_listener_open"));
    assert.ok(names.includes("bridge_listener_sync"));
    const sync = tools.tools.find((tool) => tool.name === "bridge_listener_sync");
    assert.deepEqual(sync?._meta?.ui, { visibility: ["app"] });
    const opener = tools.tools.find((tool) => tool.name === "bridge_listener_open");
    assert.equal(opener?._meta?.ui?.resourceUri, "ui://leileios/message-bridge/v5");
  } finally {
    await client.close();
    await server.close();
  }
});
