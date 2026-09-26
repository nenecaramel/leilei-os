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

function productionFactory() {
  return createProductionMcpSessionServerFactory({
    activeUserRepository: { findUserById: async () => ({ status: "active" }) },
    diaryService: {} as never,
    toyCommandService: {} as never,
    globalSearchService: {} as never,
    todoService: {} as never,
    universeService: {} as never,
    healthService: {} as never,
  });
}

const retiredConversationTools = [
  "list_conversations",
  "search_conversations",
  "read_conversation",
  "list_conversation_exclusions",
  "inspect_conversation_restore_candidates",
  "inspect_conversation_restore_path",
  "restore_conversation_exclusion",
  "list_deleted_conversation_branches",
  "archive_conversation",
  "delete_conversation_item",
  "restore_conversation_item",
  "permanently_delete_conversation_item",
] as const;

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

test("production public surface exposes current core resources and no retired Conversation Archive tools", async () => {
  const createSessionServer = productionFactory();
  const names = await listTools(createSessionServer("user-1", "public"), "mcp-production-public");

  for (const name of [
    "global_search",
    "search_diary",
    "read_todo_day",
    "list_universe_galaxies",
    "get_health",
    "render_note_card",
  ]) {
    assert.equal(names.includes(name), true, `${name} must remain public`);
  }

  for (const retired of [
    ...retiredConversationTools,
    "sentinel_get_state",
    "sentinel_claim_current_wake",
    "complete_sentinel_wake",
    "read_memory",
    "create_memory",
    "create_task",
    "list_shared_papers",
    "archive_diary",
    "restore_diary",
    "permanently_delete_diary",
    "search_universe",
    "write_diary",
    "write_todo_paper",
    "render_working_note",
    "render_thinking_block",
    "bridge_listener_open",
    "bridge_event_claim",
    "bridge_event_complete",
  ]) {
    assert.equal(names.includes(retired), false, `${retired} must stay retired`);
  }

  assert.equal(names.includes("search_notion"), false);
});

test("production internal surface keeps current maintenance tools without retired Conversation Archive recovery", async () => {
  const createSessionServer = productionFactory();
  const names = await listTools(createSessionServer("user-1", "internal"), "mcp-production-internal");

  for (const required of [
    "global_search",
    "search_diary",
    "read_todo_day",
    "create_notion_page",
    "write_notion_page",
    "get_notion_connection",
  ]) {
    assert.equal(names.includes(required), true, `internal default must expose ${required}`);
  }

  assert.equal(names.includes("render_note_card"), false);

  for (const retired of retiredConversationTools) {
    assert.equal(names.includes(retired), false, `retired Conversation tool must stay absent: ${retired}`);
  }
});
