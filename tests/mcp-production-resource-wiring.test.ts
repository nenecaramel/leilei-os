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
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

function productionFactory(input: {
  conversationArchiveReadService?: unknown;
  conversationExclusionManagementService?: unknown;
  conversationRecoveryVisibility?: "public-enabled" | "internal-only";
  bridgeService?: unknown;
  sentinelService?: unknown;
} = {}) {
  return createProductionMcpSessionServerFactory({
    activeUserRepository: { findUserById: async () => ({ status: "active" }) },
    diaryService: {} as never,
    toyCommandService: {} as never,
    globalSearchService: {} as never,
    todoService: {} as never,
    universeService: {} as never,
    healthService: {} as never,
    conversationArchiveReadService: input.conversationArchiveReadService as never,
    conversationExclusionManagementService: input.conversationExclusionManagementService as never,
    conversationRecoveryVisibility: input.conversationRecoveryVisibility,
    bridgeService: input.bridgeService as never,
    sentinelService: input.sentinelService as never,
  });
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

test("direct MCP server keeps operational connectivity outside its model surface", async () => {
  const names = await listTools(createMcpServer({} as never), "mcp-core-inventory");
  assert.equal(names.includes("hello"), false);
  assert.equal(names.includes("write_notion_page"), false);
  assert.equal(names.includes("write_notion_comment"), false);
});

test("production public surface exposes canonical Conversation reads and no retired tools", async () => {
  const createSessionServer = productionFactory({
    conversationArchiveReadService: {},
  });
  const names = await listTools(createSessionServer("user-1", "public"), "mcp-production-public");

  for (const name of ["list_conversations", "search_conversations", "read_conversation", "list_universe_galaxies", "render_note_card"]) {
    assert.equal(names.includes(name), true, `${name} must remain public`);
  }

  for (const retired of [
    "read_memory",
    "create_memory",
    "create_task",
    "list_shared_papers",
    "archive_diary",
    "restore_diary",
    "permanently_delete_diary",
    "list_deleted_conversation_branches",
    "archive_conversation",
    "delete_conversation_item",
    "restore_conversation_item",
    "permanently_delete_conversation_item",
    "search_universe",
    "write_diary",
    "write_todo_paper",
    "render_working_note",
    "render_thinking_block",
  ]) {
    assert.equal(names.includes(retired), false, `${retired} must stay retired`);
  }

  for (const hidden of [
    "sentinel_get_state",
    "bridge_listener_open",
    "list_conversation_exclusions",
    "search_notion",
  ]) {
    assert.equal(names.includes(hidden), false, `public default must hide ${hidden}`);
  }
});

test("production internal full exposes maintenance/runtime profiles without reviving retired tools", async () => {
  const createSessionServer = productionFactory({
    conversationArchiveReadService: {},
    conversationExclusionManagementService: {},
    bridgeService: {},
    sentinelService: {},
  });
  const names = await listTools(createSessionServer("user-1", "internal"), "mcp-production-internal");

  for (const required of [
    "render_note_card",
    "sentinel_get_state",
    "bridge_listener_open",
    "list_conversation_exclusions",
    "search_notion",
    "get_notion_connection",
  ]) {
    assert.equal(names.includes(required), true, `internal full must expose ${required}`);
  }

  for (const retired of [
    "read_memory",
    "write_memory",
    "create_task",
    "get_task",
    "list_shared_papers",
    "delete_shared_paper",
    "archive_diary",
    "delete_diary",
    "archive_conversation",
    "permanently_delete_conversation_item",
    "search_universe",
    "write_diary",
    "write_todo_paper",
    "render_working_note",
    "render_thinking_block",
  ]) {
    assert.equal(names.includes(retired), false, `internal full must not revive ${retired}`);
  }
});

test("Conversation recovery visibility can be internal-only while canonical reads remain public", async () => {
  const createSessionServer = productionFactory({
    conversationArchiveReadService: {},
    conversationExclusionManagementService: {},
    conversationRecoveryVisibility: "internal-only",
  });
  const publicNames = await listTools(createSessionServer("user-1", "public"), "mcp-public-recovery-hidden");
  const internalNames = await listTools(createSessionServer("user-1", "internal"), "mcp-internal-recovery-present");

  for (const name of ["list_conversation_exclusions", "inspect_conversation_restore_candidates", "inspect_conversation_restore_path", "restore_conversation_exclusion"]) {
    assert.equal(publicNames.includes(name), false, `${name} must be hidden publicly`);
    assert.equal(internalNames.includes(name), true, `${name} must remain internal`);
  }
  for (const name of ["list_conversations", "search_conversations", "read_conversation"]) {
    assert.equal(publicNames.includes(name), true, `${name} must remain public`);
  }
});
