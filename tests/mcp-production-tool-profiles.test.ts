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
      DATABASE_URL: "postgres://local",
      LOG_LEVEL: "error",
      MCP_AUTH_TOKEN: "",
      MCP_PUBLIC_TOOL_PROFILES: input.publicProfiles,
      MCP_INTERNAL_TOOL_PROFILES: input.internalProfiles,
    } as never,
    createDatabaseResource: () => fake,
  });
}

test("production public MCP defaults hide runtime, recovery, Notion advanced and UI-only tools", async () => {
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
    "read_memory",
    "search_diary",
    "list_tasks",
    "read_todo_day",
    "search_universe",
    "search_conversations",
    "list_shared_papers",
    "get_health",
    "get_current_time",
    "get_weather_context",
  ]) {
    assert.equal(
      names.includes(required),
      true,
      `public core/device must expose ${required}`,
    );
  }

  for (const hidden of [
    "sentinel_get_state",
    "sentinel_claim_current_wake",
    "complete_sentinel_wake",
    "bridge_listener_open",
    "bridge_event_claim",
    "bridge_event_complete",
    "list_conversation_exclusions",
    "inspect_conversation_restore_candidates",
    "inspect_conversation_restore_path",
    "restore_conversation_exclusion",
    "get_notion_connection",
    "search_notion",
    "render_thinking_block",
  ]) {
    assert.equal(
      names.includes(hidden),
      false,
      `public default must hide ${hidden}`,
    );
  }
});

test("production internal MCP defaults preserve full maintenance/runtime inventory", async () => {
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
    "get_notion_connection",
    "list_conversation_exclusions",
    "sentinel_get_state",
    "bridge_listener_open",
    "bridge_event_claim",
    "render_thinking_block",
  ]) {
    assert.equal(
      names.includes(required),
      true,
      `internal full profile must expose ${required}`,
    );
  }
});

test("production public MCP profile override can opt into Notion without exposing runtime internals", async () => {
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

  assert.equal(names.includes("search_notion"), true);
  assert.equal(names.includes("get_notion_connection"), true);
  assert.equal(names.includes("sentinel_get_state"), false);
  assert.equal(names.includes("bridge_listener_open"), false);
});
