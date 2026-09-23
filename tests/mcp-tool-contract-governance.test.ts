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

function jsonSchemaContains(
  root: Record<string, unknown>,
  schema: unknown,
  predicate: (candidate: Record<string, unknown>) => boolean,
  seenRefs = new Set<string>(),
): boolean {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
  const candidate = schema as Record<string, unknown>;
  if (predicate(candidate)) return true;

  const ref = candidate.$ref;
  if (typeof ref === "string" && ref.startsWith("#/") && !seenRefs.has(ref)) {
    seenRefs.add(ref);
    const target = ref
      .slice(2)
      .split("/")
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce<unknown>((current, segment) => {
        if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
        return (current as Record<string, unknown>)[segment];
      }, root);
    if (jsonSchemaContains(root, target, predicate, seenRefs)) return true;
  }

  return Object.values(candidate).some((value) => {
    if (Array.isArray(value)) {
      return value.some((entry) => jsonSchemaContains(root, entry, predicate, seenRefs));
    }
    return jsonSchemaContains(root, value, predicate, seenRefs);
  });
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

  const writeTodo = byName.get("replace_todo_paper");
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

test("domain language disambiguates adjacent model-facing concepts", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const groups = [
    {
      names: ["create_task", "list_tasks", "get_task", "update_task", "transition_task"],
      pattern: /^Task is a durable actionable item .*not a date-scoped Todo/iu,
    },
    {
      names: ["read_todo_day", "list_todo_dates", "search_todo", "replace_todo_paper", "append_todo_entries", "append_todo_entry", "update_todo_entry", "delete_todo_entry"],
      pattern: /^Todo is a date-scoped paper .*not the Task system/iu,
    },
    {
      names: ["read_memory", "search_memory", "get_memory", "create_memory", "update_memory"],
      pattern: /^Memory stores durable distilled .*not a dated Diary/iu,
    },
    {
      names: ["search_diary", "get_diary", "create_diary", "update_diary"],
      pattern: /^Diary stores dated authored .*not distilled Memory/iu,
    },
    {
      names: ["list_shared_papers", "search_shared_papers", "get_shared_paper", "create_shared_paper", "edit_shared_paper", "append_shared_paper"],
      pattern: /^Shared Paper is a canonical long-form document .*not the Universe graph/iu,
    },
  ] as const;

  for (const group of groups) {
    for (const name of group.names) {
      const tool = byName.get(name);
      assert.ok(tool?.description, `${name} must have a domain boundary description`);
      assert.match(tool.description, group.pattern);
    }
  }

  for (const name of ["list_universe_nodes", "search_universe", "get_universe_node", "get_universe_relations"] as const) {
    const tool = byName.get(name);
    assert.ok(tool?.description, `${name} must have a Universe boundary description`);
    assert.match(tool.description, /^Universe is a graph .*not a Shared Paper/iu);
  }

  for (const name of [
    "create_universe_node",
    "update_universe_node",
    "create_universe_relation",
    "update_universe_relation",
    "delete_universe_relation",
    "add_universe_diary_source",
    "delete_universe_diary_source",
  ] as const) {
    const tool = byName.get(name);
    assert.ok(tool?.description, `${name} must have a Universe boundary description`);
    assert.match(tool.description, /Universe is a graph .*not a Shared Paper/iu);
  }
});

test("L G C author enums expose stable human-readable semantics", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const authorTools = [
    "create_memory",
    "update_memory",
    "search_diary",
    "create_diary",
    "update_diary",
    "add_diary_comment",
    "create_task",
    "update_task",
    "read_todo_day",
    "search_todo",
    "replace_todo_paper",
    "append_todo_entries",
    "append_todo_entry",
    "update_todo_entry",
    "delete_todo_entry",
    "create_shared_paper",
    "edit_shared_paper",
    "append_shared_paper",
  ] as const;

  for (const name of authorTools) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must stay registered`);
    const author = property(tool, "author");
    assert.deepEqual(author.enum, ["L", "G", "C"]);
    const description = String(author.description ?? "");
    assert.match(description, /L\s*=\s*蕾蕾\s*\/\s*user/iu);
    assert.match(description, /G\s*=\s*ChatGPT/iu);
    assert.match(description, /C\s*=\s*Claude/iu);
  }
});

test("date filter schemas stay concrete and bounded", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const name of ["search_diary", "search_todo"] as const) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must stay registered`);
    const root = tool.inputSchema as Record<string, unknown>;
    for (const field of ["date_from", "date_to"] as const) {
      const schema = property(tool, field);
      assert.ok(
        jsonSchemaContains(root, schema, (candidate) => candidate.type === "string"),
        `${name}.${field} must resolve to a string schema`,
      );
      assert.ok(
        jsonSchemaContains(
          root,
          schema,
          (candidate) => candidate.pattern === "^\\d{4}-\\d{2}-\\d{2}$",
        ),
        `${name}.${field} must retain the YYYY-MM-DD pattern`,
      );
    }
  }
});

test("mutation preconditions and idempotency use one model-facing vocabulary", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const revisionedTools = [
    "write_todo_paper",
    "update_todo_entry",
    "delete_todo_entry",
    "edit_shared_paper",
    "append_shared_paper",
    "update_diary_comment",
    "delete_diary_comment",
  ] as const;

  for (const name of revisionedTools) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must stay registered`);
    assert.ok(property(tool, "expected_revision"));
    if (name === "replace_todo_paper") {
      assert.equal(
        "revision" in ((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}),
        false,
        "replace_todo_paper must expose expected_revision, not revision, as its concurrency precondition",
      );
    }
  }

  const idempotentTools = [
    "write_memory",
    "write_diary",
    "create_task",
    "replace_todo_paper",
    "append_todo_entries",
    "append_todo_entry",
    "update_todo_entry",
    "delete_todo_entry",
    "create_shared_paper",
    "edit_shared_paper",
    "append_shared_paper",
    "archive_shared_paper",
    "restore_shared_paper",
    "permanently_delete_shared_paper",
    "add_diary_comment",
    "create_universe_node",
    "create_universe_relation",
    "toy_set",
    "toy_stop",
  ] as const;

  for (const name of idempotentTools) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must stay registered`);
    const key = property(tool, "idempotency_key");
    assert.match(String(key.description ?? ""), /one logical mutation/iu);
    assert.match(String(key.description ?? ""), /exact same request/iu);
    assert.ok(
      (tool.inputSchema.required ?? []).includes("idempotency_key"),
      `${name} must keep explicit idempotency_key until the host exposes a durable logical-mutation id`,
    );
  }

  const universeMutationTools = [
    "create_universe_node",
    "update_universe_node",
    "create_universe_relation",
    "update_universe_relation",
    "delete_universe_relation",
    "add_universe_diary_source",
    "delete_universe_diary_source",
  ] as const;

  for (const name of universeMutationTools) {
    const tool = byName.get(name);
    assert.ok(tool?.description, `${name} must stay registered`);
    assert.match(
      tool.description,
      /^expected_version is the global Universe snapshot version, not an entity revision\./u,
    );
    assert.match(
      String(property(tool, "expected_version").description ?? ""),
      /not an entity revision/iu,
    );
    assert.equal(
      "expected_revision" in ((tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}),
      false,
      `${name} must retain expected_version because its precondition is global, not entity-local`,
    );
  }
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
    "create_memory",
    "update_memory",
    "create_diary",
    "update_diary",
    "archive_diary",
    "restore_diary",
    "permanently_delete_diary",
    "add_diary_comment",
    "update_diary_comment",
    "delete_diary_comment",
    "create_task",
    "update_task",
    "transition_task",
    "replace_todo_paper",
    "append_todo_entries",
    "append_todo_entry",
    "update_todo_entry",
    "delete_todo_entry",
    "create_shared_paper",
    "edit_shared_paper",
    "append_shared_paper",
    "archive_shared_paper",
    "restore_shared_paper",
    "permanently_delete_shared_paper",
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
