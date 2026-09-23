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
    (sum, tool) => sum + tool.name.length + (tool.title?.length ?? 0),
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

  console.log("[MCP_FINAL_AUDIT]", JSON.stringify({
    tool_count: tools.length,
    description_chars: descriptionChars,
    input_schema_chars: inputSchemaChars,
    output_schema_chars: outputSchemaChars,
    schema_chars: inputSchemaChars + outputSchemaChars,
    total_definition_chars: totalDefinitionChars,
    longest_descriptions: longestDescriptions,
  }));

  assert.ok(
    tools.length <= 66,
    `default public surface must stay at or below 66 tools, got ${tools.length}`,
  );
  for (const tool of tools) {
    assert.ok(
      (tool.description?.length ?? 0) <= 700,
      `${tool.name} description must stay at or below 700 chars`,
    );
  }

  const names = new Set(tools.map((tool) => tool.name));
  for (const hidden of [
    "render_working_note",
    "render_thinking_block",
    "write_memory",
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
    { name: "find_and_read_memory", calls: ["search_memory", "get_memory"] },
    { name: "find_and_read_diary", calls: ["search_diary", "get_diary"] },
    { name: "append_known_shared_paper", calls: ["append_shared_paper"] },
    { name: "create_memory", calls: ["create_memory"] },
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
