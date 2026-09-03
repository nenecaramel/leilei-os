import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { createProductionMcpSessionServerFactory } from "../src/mcp/server/production-server-factory.js";

const createServerSource = readFileSync("src/mcp/server/create-server.ts", "utf8");
const routerSource = readFileSync("src/mcp/server/router.ts", "utf8");

async function listTools(server: McpServer, clientName: string): Promise<string[]> {
  const client = new Client(
    { name: clientName, version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.listTools();
    return result.tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

test("production MCP server composition cannot create database pools", () => {
  assert.doesNotMatch(createServerSource, /createDatabase/);
  assert.doesNotMatch(
    createServerSource,
    /getDefaultMemoryService|getDefaultDiaryService|getDefaultTaskService|getDefaultTodoService|getDefaultUniverseService|getDefaultActiveUserRepository/,
  );
  assert.match(routerSource, /createSessionServer/);
  assert.doesNotMatch(routerSource, /registerProductionNotionExplicitWriteTools/);
});

test("direct MCP server keeps the 40-tool core surface", async () => {
  const names = await listTools(createMcpServer({} as never), "mcp-core-inventory");
  assert.equal(names.length, 40);
  assert.equal(names.includes("write_notion_page"), false);
  assert.equal(names.includes("write_notion_comment"), false);
});

test("production MCP session factory assembles 55 public tools with Bridge processing, Sentinel tools, and each Notion write once", async () => {
  const createSessionServer = createProductionMcpSessionServerFactory({
    activeUserRepository: {
      findUserById: async () => ({ status: "active" }),
    },
    memoryService: {} as never,
    diaryService: {} as never,
    taskService: {} as never,
    toyCommandService: {} as never,
    globalSearchService: {} as never,
    todoService: {} as never,
    universeService: {} as never,
    bridgeService: {} as never,
    sentinelService: { getWakeState: async () => { throw new Error("unused"); }, completeWake: async () => { throw new Error("unused"); }, claimCurrentWake: async () => { throw new Error("unused"); } } as never,
  });

  const names = await listTools(createSessionServer("user-1"), "mcp-production-inventory");

  assert.equal(names.length, 55);
  assert.equal(names.filter((name) => name === "sentinel_get_state").length, 1);
  assert.equal(names.filter((name) => name === "complete_sentinel_wake").length, 1);
  assert.equal(names.filter((name) => name === "sentinel_claim_current_wake").length, 1);
  assert.equal(names.filter((name) => name === "write_notion_page").length, 1);
  assert.equal(names.filter((name) => name === "write_notion_comment").length, 1);
  assert.equal(names.filter((name) => name === "bridge_event_claim").length, 1);
  assert.equal(names.filter((name) => name === "bridge_event_complete").length, 1);
});

test("internal MCP session factory remains free of Bridge App tools", async () => {
  const createSessionServer = createProductionMcpSessionServerFactory({
    activeUserRepository: { findUserById: async () => ({ status: "active" }) },
    memoryService: {} as never, diaryService: {} as never, taskService: {} as never,
    toyCommandService: {} as never, globalSearchService: {} as never, todoService: {} as never,
    universeService: {} as never, bridgeService: {} as never,
    sentinelService: { getWakeState: async () => { throw new Error("unused"); }, completeWake: async () => { throw new Error("unused"); }, claimCurrentWake: async () => { throw new Error("unused"); } } as never,
  });
  const names = await listTools(createSessionServer("user-1", "internal"), "mcp-internal-inventory");
  assert.equal(names.filter((name) => name.startsWith("bridge_listener_")).length, 0);
  assert.equal(names.includes("bridge_event_claim"), false);
  assert.equal(names.includes("bridge_event_complete"), false);
  assert.equal(names.includes("sentinel_get_state"), false);
  assert.equal(names.includes("complete_sentinel_wake"), false);
});
