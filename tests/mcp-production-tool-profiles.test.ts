import { env } from "../src/config/env.js";
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProcessRuntime } from "../src/app/process-runtime.js";

async function listTools(server: McpServer): Promise<string[]> {
  const client = new Client(
    { name: "tool-profile-acceptance", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools
      .map((tool) => tool.name)
      .sort();
  } finally {
    await client.close();
    await server.close();
  }
}

function runtime(input: {
  publicProfiles?: string;
  internalProfiles?: string;
} = {}) {
  const fake = {
    db: {} as never,
    probe: async () => undefined,
    close: async () => undefined,
  };
  return createProcessRuntime({
    environment: {
      ...env,
      DATABASE_URL: "postgres://local",
      LOG_LEVEL: "error",
      MCP_AUTH_TOKEN: "",
      MCP_PUBLIC_TOOL_PROFILES: input.publicProfiles,
      MCP_INTERNAL_TOOL_PROFILES: input.internalProfiles,
    } as never,
    createDatabaseResource: () => fake,
  });
}

test("production public MCP defaults expose current core, device, and UI tools only", async () => {
  const process = runtime();
  const factory = process.appDependencies.createMcpSessionServer;
  assert.ok(factory);

  const names = await listTools(
    factory(
      "11111111-1111-4111-8111-111111111111",
      "public",
    ),
  );

  for (const required of [
    "global_search",
    "search_diary",
    "get_diary",
    "create_diary",
    "update_diary",
    "read_todo_day",
    "append_todo_entries",
    "get_health",
    "get_current_time",
    "list_universe_galaxies",
    "render_note_card",
  ]) {
    assert.equal(
      names.includes(required),
      true,
      `public core/device/ui must expose ${required}`,
    );
  }

  for (const hidden of [
    "sentinel_get_state",
    "sentinel_claim_current_wake",
    "complete_sentinel_wake",
    "list_conversations",
    "search_conversations",
    "read_conversation",
    "list_conversation_exclusions",
    "inspect_conversation_restore_candidates",
    "inspect_conversation_restore_path",
    "restore_conversation_exclusion",
    "get_notion_connection",
    "search_notion",
    "create_notion_page",
    "write_notion_page",
    "render_working_note",
    "render_thinking_block",
    "write_diary",
    "write_todo_paper",
    "read_memory",
    "create_memory",
    "create_task",
    "list_shared_papers",
    "archive_diary",
    "list_deleted_conversation_branches",
    "archive_conversation",
  ]) {
    assert.equal(
      names.includes(hidden),
      false,
      `public default must hide ${hidden}`,
    );
  }
});

test("production internal MCP defaults expose current advanced maintenance inventory", async () => {
  const process = runtime();
  const factory = process.appDependencies.createMcpSessionServer;
  assert.ok(factory);

  const names = await listTools(
    factory(
      "11111111-1111-4111-8111-111111111111",
      "internal",
    ),
  );

  for (const required of [
    "global_search",
    "create_notion_page",
    "write_notion_page",
    "get_notion_connection",
    "create_diary",
    "replace_todo_paper",
  ]) {
    assert.equal(
      names.includes(required),
      true,
      `internal full profile must expose ${required}`,
    );
  }
  assert.equal(names.includes("render_note_card"), false);

  for (const retired of [
    "sentinel_get_state",
    "sentinel_claim_current_wake",
    "complete_sentinel_wake",
    "list_conversations",
    "search_conversations",
    "read_conversation",
    "list_conversation_exclusions",
    "inspect_conversation_restore_candidates",
    "inspect_conversation_restore_path",
    "restore_conversation_exclusion",
  ]) {
    assert.equal(
      names.includes(retired),
      false,
      `retired Sentinel tool must stay absent: ${retired}`,
    );
  }
});

test("production public Notion profile exposes typed facade but hides raw advanced tools", async () => {
  const process = runtime({
    publicProfiles: "core,device,notion",
  });
  const factory = process.appDependencies.createMcpSessionServer;
  assert.ok(factory);

  const names = await listTools(
    factory(
      "11111111-1111-4111-8111-111111111111",
      "public",
    ),
  );

  for (const required of [
    "search_notion",
    "read_notion_page",
    "create_notion_page",
    "update_notion_page_properties",
    "append_notion_page_content",
    "replace_notion_page_content",
    "add_notion_comment",
    "reply_notion_comment",
  ]) {
    assert.equal(names.includes(required), true, `typed Notion profile must expose ${required}`);
  }
  for (const hidden of [
    "get_notion_connection",
    "read_notion_database",
    "read_notion_data_source",
    "query_notion_data_source",
    "write_notion_page",
    "write_notion_comment",
    "sentinel_get_state",
  ]) {
    assert.equal(names.includes(hidden), false, `typed Notion profile must hide ${hidden}`);
  }
});

test("production public notion_advanced profile includes typed and explicit advanced Notion surfaces", async () => {
  const process = runtime({
    publicProfiles: "core,device,notion_advanced",
  });
  const factory = process.appDependencies.createMcpSessionServer;
  assert.ok(factory);

  const names = await listTools(
    factory(
      "11111111-1111-4111-8111-111111111111",
      "public",
    ),
  );

  for (const required of [
    "search_notion",
    "read_notion_page",
    "create_notion_page",
    "get_notion_connection",
    "read_notion_database",
    "read_notion_data_source",
    "query_notion_data_source",
    "write_notion_page",
    "write_notion_comment",
  ]) {
    assert.equal(names.includes(required), true, `advanced Notion profile must expose ${required}`);
  }
  assert.equal(names.includes("sentinel_get_state"), false);
});
