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
    "write_memory",
    "search_memory",
    "get_memory",
    "read_memory_day",
    "update_memory",
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
    "update_concern",
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
    "create_diary",
    "write_memory",
    "search_memory",
    "get_memory",
    "read_memory_day",
    "update_memory",
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
    "update_concern",
  ]) {
    assert.equal(
      names.includes(retired),
      false,
      `retired tool must stay absent: ${retired}`,
    );
  }
});

test("no profile exposes a Notion tool", async () => {
  const process = runtime({ publicProfiles: "full", internalProfiles: "full" });
  const factory = process.appDependencies.createMcpSessionServer;
  assert.ok(factory);
  for (const namespace of ["public", "internal"] as const) {
    const names = await listTools(factory("11111111-1111-4111-8111-111111111111", namespace));
    assert.ok(names.includes("get_diary"));
    assert.deepEqual(names.filter((name) => name.includes("notion")), []);
  }
});
