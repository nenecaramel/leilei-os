import { env } from "../src/config/env.js";
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProcessRuntime } from "../src/app/process-runtime.js";

type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

function runtime() {
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
    } as never,
    createDatabaseResource: () => fake,
  });
}

async function listTools(server: McpServer): Promise<ListedTool[]> {
  const client = new Client(
    { name: "final-surface-audit", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
    await server.close();
  }
}

function jsonChars(value: unknown): number {
  return JSON.stringify(value ?? {}).length;
}

test("default production public surface stays compact and reports final inventory metrics", async () => {
  const process = runtime();
  const factory = process.appDependencies.createMcpSessionServer;
  assert.ok(factory);
  const tools = await listTools(
    factory("11111111-1111-4111-8111-111111111111", "public"),
  );
  const fullTools = await listTools(
    factory("11111111-1111-4111-8111-111111111111", "internal"),
  );

  const descriptionChars = tools.reduce(
    (sum, tool) => sum + (tool.description?.length ?? 0),
    0,
  );
  const inputSchemaChars = tools.reduce(
    (sum, tool) => sum + jsonChars(tool.inputSchema),
    0,
  );
  const outputSchemaChars = tools.reduce(
    (sum, tool) => sum + jsonChars(tool.outputSchema),
    0,
  );
  const identityChars = tools.reduce(
    (sum, tool) => sum + tool.name.length,
    0,
  );
  const totalDefinitionChars =
    identityChars + descriptionChars + inputSchemaChars + outputSchemaChars;
  const longestDescriptions = [...tools]
    .sort((a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0))
    .slice(0, 8)
    .map((tool) => ({
      name: tool.name,
      chars: tool.description?.length ?? 0,
    }));

  const fullDescriptionChars = fullTools.reduce(
    (sum, tool) => sum + (tool.description?.length ?? 0),
    0,
  );
  const fullSchemaChars = fullTools.reduce(
    (sum, tool) => sum + jsonChars(tool.inputSchema) + jsonChars(tool.outputSchema),
    0,
  );

  console.log("[MCP_FINAL_AUDIT]", JSON.stringify({
    public_default: {
      tool_count: tools.length,
      tool_names: tools.map((tool) => tool.name).sort(),
      description_chars: descriptionChars,
      input_schema_chars: inputSchemaChars,
      output_schema_chars: outputSchemaChars,
      schema_chars: inputSchemaChars + outputSchemaChars,
      total_definition_chars: totalDefinitionChars,
      longest_descriptions: longestDescriptions,
    },
    internal_full: {
      tool_count: fullTools.length,
      description_chars: fullDescriptionChars,
      schema_chars: fullSchemaChars,
    },
    reduction: {
      tool_count: fullTools.length - tools.length,
      schema_chars: fullSchemaChars - (inputSchemaChars + outputSchemaChars),
      description_chars: fullDescriptionChars - descriptionChars,
    },
  }));

  const expectedPublicNames = [
    "add_diary_comment",
    "add_universe_diary_source",
    "append_todo_entries",
    "append_todo_entry",
    "create_diary",
    "create_universe_node",
    "create_universe_relation",
    "delete_diary_comment",
    "delete_todo_entry",
    "delete_universe_diary_source",
    "delete_universe_relation",
    "get_current_time",
    "get_diary",
    "get_diary_comment",
    "get_health",
    "get_universe_diary_sources",
    "get_universe_node",
    "get_universe_relations",
    "global_search",
    "list_diary_comments",
    "list_todo_dates",
    "list_universe_galaxies",
    "list_universe_nodes",
    "read_todo_day",
    "replace_todo_paper",
    "render_note_card",
    "search_diary",
    "search_todo",
    "toy_set",
    "toy_stop",
    "update_diary",
    "update_diary_comment",
    "update_todo_entry",
    "update_universe_node",
    "update_universe_relation",
    "write_memory",
  ];

  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    expectedPublicNames.sort(),
    "default public inventory must stay exact",
  );
  assert.equal(tools.length, 36);
  assert.ok(
    tools.length < fullTools.length,
    "default public surface must be smaller than internal full",
  );
  for (const tool of tools) {
    assert.ok(
      (tool.description?.length ?? 0) <= 300,
      `${tool.name} description must stay at or below 300 chars`,
    );
  }
  for (const tool of fullTools) {
    assert.ok(
      (tool.description?.length ?? 0) <= 300,
      `${tool.name} full-profile description must stay at or below 300 chars`,
    );
  }

  const fullNames = new Set(fullTools.map((tool) => tool.name));
  for (const retired of [
    "read_memory",
    "search_memory",
    "get_memory",
    "create_memory",
    "update_memory",
    "create_task",
    "update_task",
    "transition_task",
    "list_tasks",
    "get_task",
    "list_shared_papers",
    "search_shared_papers",
    "get_shared_paper",
    "create_shared_paper",
    "edit_shared_paper",
    "append_shared_paper",
    "list_shared_paper_edits",
    "archive_shared_paper",
    "restore_shared_paper",
    "permanently_delete_shared_paper",
    "delete_shared_paper",
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
    "archive_diary",
    "restore_diary",
    "permanently_delete_diary",
    "delete_diary",
    "search_universe",
    "write_diary",
    "write_todo_paper",
    "render_working_note",
    "render_thinking_block",
  ]) {
    assert.equal(fullNames.has(retired), false, `retired MCP tool must be absent even from full: ${retired}`);
  }

  const names = new Set(tools.map((tool) => tool.name));
  for (const hidden of [
    "render_working_note",
    "render_thinking_block",
    "write_diary",
    "write_todo_paper",
    "delete_diary",
    "delete_shared_paper",
    "sentinel_get_state",
    "bridge_listener_open",
    "list_conversation_exclusions",
    "get_notion_connection",
    "write_notion_page",
  ]) {
    assert.equal(names.has(hidden), false, `default public must hide ${hidden}`);
  }
});

test("common user intents keep short model-facing tool paths", async () => {
  const process = runtime();
  const factory = process.appDependencies.createMcpSessionServer;
  assert.ok(factory);
  const tools = await listTools(
    factory("11111111-1111-4111-8111-111111111111", "public"),
  );
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const appendBatch = byName.get("append_todo_entries");
  assert.ok(appendBatch);
  const entries = (appendBatch.inputSchema.properties?.entries ?? {}) as {
    maxItems?: number;
  };
  assert.ok((entries.maxItems ?? 0) >= 20);
  assert.equal(
    "expected_revision" in (appendBatch.inputSchema.properties ?? {}),
    false,
  );

  const scenarios = [
    { name: "append_20_todo_entries", calls: ["append_todo_entries"] },
    { name: "find_and_read_diary", calls: ["search_diary", "get_diary"] },
    { name: "find_and_read_universe", calls: ["global_search", "get_universe_node"] },
    { name: "create_diary", calls: ["create_diary"] },
  ] as const;

  for (const scenario of scenarios) {
    for (const toolName of scenario.calls) {
      assert.ok(byName.has(toolName), `${scenario.name} requires ${toolName}`);
    }
  }
  const averageCalls =
    scenarios.reduce((sum, scenario) => sum + scenario.calls.length, 0)
    / scenarios.length;

  console.log("[MCP_COMMON_PATH_AUDIT]", JSON.stringify({
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      calls: scenario.calls.length,
      tools: scenario.calls,
    })),
    average_calls: averageCalls,
  }));

  assert.ok(averageCalls <= 2);
});
