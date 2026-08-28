import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

test("bridge listener tool surface is model/app split", async () => {
  const server = createMcpServer({ bridgeListener: {
    bridgeService: {} as never,
    getAuthenticatedUserId: () => "user-1",
    listenerInstanceId: "00000000-0000-4000-8000-000000000001",
  } } as never, "user-1");
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
  } finally {
    await client.close();
    await server.close();
  }
});
