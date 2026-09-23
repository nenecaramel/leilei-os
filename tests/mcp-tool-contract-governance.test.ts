import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

async function listTools(server: McpServer): Promise<ListedTool[]> {
  const client = new Client(
    { name: "tool-contract-governance", version: "1.0.0" },
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

function property(tool: ListedTool, name: string): Record<string, unknown> {
  const properties = (tool.inputSchema as {
    properties?: Record<string, Record<string, unknown>>;
  }).properties;
  const result = properties?.[name];
  assert.ok(result, `${tool.name} must expose input property ${name}`);
  return result;
}

test("stable MCP defaults are explicit in tools/list", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const globalSearch = byName.get("global_search");
  assert.ok(globalSearch);
  assert.deepEqual(
    property(globalSearch, "modules").default,
    ["memory", "diary", "task", "todo", "universe", "shared_paper"],
  );
  assert.equal(property(globalSearch, "scope").default, "active");
  assert.equal(property(globalSearch, "mode").default, "normal");
  assert.equal(property(globalSearch, "limit").default, 10);

  for (const name of ["get_memory", "get_diary", "get_task"] as const) {
    const tool = byName.get(name);
    assert.ok(tool);
    assert.equal(property(tool, "scope").default, "active");
  }

  for (const name of ["list_shared_papers", "search_shared_papers"] as const) {
    const tool = byName.get(name);
    assert.ok(tool);
    assert.equal(property(tool, "scope").default, "active");
    assert.equal(property(tool, "limit").default, 50);
  }

  const expectedLimits: Record<string, number> = {
    read_memory: 50,
    search_memory: 50,
    search_diary: 50,
    list_tasks: 50,
    search_todo: 50,
    list_todo_dates: 50,
    list_universe_nodes: 25,
    search_universe: 10,
    search_conversations: 20,
    read_conversation: 40,
    list_conversation_exclusions: 50,
    inspect_conversation_restore_path: 40,
    list_shared_paper_edits: 50,
  };
  for (const [name, expected] of Object.entries(expectedLimits)) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must stay registered`);
    assert.equal(property(tool, "limit").default, expected);
  }
});

test("growth discovery tools expose one cursor pagination contract", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of [
    "read_memory",
    "search_memory",
    "search_diary",
    "list_tasks",
    "list_todo_dates",
    "search_todo",
    "list_shared_papers",
    "search_shared_papers",
  ] as const) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must stay registered`);
    assert.ok(property(tool, "limit"));
    assert.ok(property(tool, "cursor"));
    const data = (tool.outputSchema as {
      properties?: {
        data?: {
          properties?: {
            metadata?: { properties?: Record<string, unknown> };
          };
        };
      };
    }).properties?.data?.properties?.metadata?.properties;
    assert.ok(data, `${name} must expose pagination metadata`);
    for (const field of ["returned", "has_more", "next_cursor"]) {
      assert.ok(field in data, `${name} pagination metadata must expose ${field}`);
    }
  }
});

test("discovery contracts keep Global Search cross-domain and dedicated tools domain-first", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const globalSearch = byName.get("global_search");
  assert.ok(globalSearch?.description);
  assert.match(globalSearch.description, /cross-domain discovery/iu);
  assert.match(globalSearch.description, /domain is known.*dedicated/iu);
  assert.match(globalSearch.description, /does not replace domain-specific detail or mutation tools/iu);

  const dedicatedDiscovery = [
    ["read_memory", "get_memory"],
    ["search_memory", "get_memory"],
    ["search_diary", "get_diary"],
    ["list_tasks", "get_task"],
    ["search_todo", "read_todo_day"],
    ["list_universe_nodes", "get_universe_node"],
    ["search_universe", "get_universe_node"],
    ["list_shared_papers", "get_shared_paper"],
    ["search_shared_papers", "get_shared_paper"],
    ["search_conversations", "read_conversation"],
  ] as const;

  for (const [name, detailTool] of dedicatedDiscovery) {
    const tool = byName.get(name);
    assert.ok(tool?.description, `${name} must have routing guidance`);
    assert.match(tool.description, new RegExp(detailTool, "iu"));
  }

  const writeTodo = byName.get("write_todo_paper");
  assert.ok(writeTodo?.description);
  for (const entryTool of ["append_todo_entry", "append_todo_entries", "update_todo_entry", "delete_todo_entry"]) {
    assert.match(writeTodo.description, new RegExp(entryTool, "iu"));
    assert.ok(byName.has(entryTool), `${entryTool} must stay registered`);
  }
  assert.match(byName.get("append_todo_entry")?.description ?? "", /does not require the paper revision/iu);
  assert.match(byName.get("append_todo_entries")?.description ?? "", /atomically/iu);
  assert.match(byName.get("append_todo_entries")?.description ?? "", /one idempotency_key/iu);
  assert.match(byName.get("update_todo_entry")?.description ?? "", /only that entry revision is compared/iu);
  assert.match(byName.get("delete_todo_entry")?.description ?? "", /only that entry revision is compared/iu);
});

test("large detail reads expose one bounded continuation contract", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const name of [
    "get_memory",
    "get_diary",
    "get_shared_paper",
    "read_notion_page",
  ] as const) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must stay registered`);
    assert.equal(property(tool, "max_chars").default, 12_000);
    assert.ok(property(tool, "cursor"));

    const dataProperties = (tool.outputSchema as {
      properties?: {
        data?: {
          properties?: Record<string, {
            properties?: Record<string, unknown>;
          }>;
        };
      };
    }).properties?.data?.properties;
    assert.ok(dataProperties, `${name} must expose structured data`);
    const metadata = dataProperties.content_metadata?.properties;
    assert.ok(metadata, `${name} must expose content_metadata`);
    for (const field of [
      "returned_chars",
      "total_chars",
      "truncated",
      "next_cursor",
    ]) {
      assert.ok(field in metadata, `${name} content_metadata must expose ${field}`);
    }
  }
});

test("core mutation tools expose one model-readable receipt contract", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const mutationTools = [
    "write_memory",
    "update_memory",
    "write_diary",
    "update_diary",
    "archive_diary",
    "restore_diary",
    "delete_diary",
    "add_diary_comment",
    "update_diary_comment",
    "delete_diary_comment",
    "create_task",
    "update_task",
    "transition_task",
    "write_todo_paper",
    "append_todo_entries",
    "append_todo_entry",
    "update_todo_entry",
    "delete_todo_entry",
    "create_shared_paper",
    "edit_shared_paper",
    "append_shared_paper",
    "archive_shared_paper",
    "restore_shared_paper",
    "delete_shared_paper",
    "create_universe_node",
    "update_universe_node",
    "create_universe_relation",
    "update_universe_relation",
    "delete_universe_relation",
    "add_universe_diary_source",
    "delete_universe_diary_source",
  ] as const;

  for (const name of mutationTools) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must stay registered`);
    const data = (tool.outputSchema as {
      properties?: {
        data?: {
          properties?: Record<string, unknown>;
        };
      };
    }).properties?.data?.properties;
    assert.ok(data, `${name} must expose structured mutation data`);
    for (const field of [
      "outcome",
      "entity_type",
      "entity_id",
      "revision",
      "detail_tool",
      "detail_arguments",
    ]) {
      assert.ok(field in data, `${name} must expose mutation field ${field}`);
    }
    assert.equal(
      "metadata" in data,
      false,
      `${name} must not require model interpretation of legacy mutation metadata`,
    );

    const errorProperties = (tool.outputSchema as {
      properties?: {
        error?: {
          properties?: Record<string, unknown>;
        };
      };
    }).properties?.error?.properties;
    assert.ok(errorProperties, `${name} must expose structured error data`);
    for (const field of [
      "retryable",
      "reason",
      "current_revision",
      "recommended_tool",
      "recommended_arguments",
    ]) {
      assert.ok(
        field in errorProperties,
        `${name} error schema must expose recovery field ${field}`,
      );
    }
  }
});

test("operational connectivity stays out of the model-visible tool inventory", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const names = tools.map((tool) => tool.name);
  assert.equal(names.includes("hello"), false);
});
