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
    ["diary", "todo", "universe"],
  );
  assert.equal(property(globalSearch, "scope").default, "active");
  assert.equal(property(globalSearch, "mode").default, "normal");
  assert.equal(property(globalSearch, "limit").default, 10);

  const diary = byName.get("get_diary");
  assert.ok(diary);
  assert.equal(property(diary, "scope").default, "active");

  const expectedLimits: Record<string, number> = {
    search_diary: 50,
    search_todo: 50,
    list_todo_dates: 50,
    list_universe_nodes: 25,
    search_conversations: 20,
    read_conversation: 40,
    list_conversation_exclusions: 50,
    inspect_conversation_restore_path: 40,
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
    "search_diary",
    "list_todo_dates",
    "search_todo",
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
  assert.match(globalSearch.description, /LeileiOS modules/iu);
  assert.match(globalSearch.description, /domain search when the domain is known/iu);

  const dedicatedDiscovery = [
    ["search_diary", "get_diary"],
    ["search_todo", "read_todo_day"],
    ["list_universe_nodes", "get_universe_node"],
    ["search_conversations", "read_conversation"],
  ] as const;

  for (const [name, detailTool] of dedicatedDiscovery) {
    const tool = byName.get(name);
    assert.ok(tool?.description, `${name} must have routing guidance`);
    assert.match(tool.description, new RegExp(detailTool, "iu"));
  }

  const writeTodo = byName.get("replace_todo_paper");
  assert.ok(writeTodo?.description);
  assert.match(writeTodo.description, /entry tools for single-entry changes/iu);
  for (const entryTool of ["append_todo_entry", "append_todo_entries", "update_todo_entry", "delete_todo_entry"]) {
    assert.ok(byName.has(entryTool), `${entryTool} must stay registered`);
  }
  assert.match(byName.get("append_todo_entry")?.description ?? "", /paper revision is not required/iu);
  assert.match(byName.get("append_todo_entries")?.description ?? "", /atomically/iu);
  assert.match(byName.get("update_todo_entry")?.description ?? "", /other entries are independent/iu);
  assert.match(byName.get("delete_todo_entry")?.description ?? "", /other entries are independent/iu);
});

test("tool descriptions stay concise without repeated domain boilerplate", async () => {
  const tools = await listTools(createMcpServer({} as never));

  for (const tool of tools) {
    assert.ok(tool.description, `${tool.name} must have a description`);
    assert.doesNotMatch(
      tool.description,
      /dated lightweight entries|dated journal entries|concept graph with relations and provenance/iu,
      `${tool.name} must not repeat domain boilerplate`,
    );
  }
});

test("L G C author enums expose stable human-readable semantics", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const authorTools = [
    "search_diary",
    "create_diary",
    "update_diary",
    "add_diary_comment",
    "read_todo_day",
    "search_todo",
    "replace_todo_paper",
    "append_todo_entries",
    "append_todo_entry",
    "update_todo_entry",
    "delete_todo_entry",
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
    "replace_todo_paper",
    "update_todo_entry",
    "delete_todo_entry",
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
    "create_diary",
    "replace_todo_paper",
    "append_todo_entries",
    "append_todo_entry",
    "update_todo_entry",
    "delete_todo_entry",
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

test("Diary update and Universe read/write boundary semantics stay explicit", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const updateDiary = byName.get("update_diary");
  assert.ok(updateDiary?.description);
  assert.match(updateDiary.description, /no revision precondition is required/iu);
  const updateDiaryProperties = (updateDiary.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
  assert.equal("expected_revision" in updateDiaryProperties, false);
  assert.equal("idempotency_key" in updateDiaryProperties, false);

  const nestedProperties = (toolName: string, field?: string) => {
    const tool = byName.get(toolName);
    assert.ok(tool, `${toolName} must stay registered`);
    const data = (tool.outputSchema as {
      properties?: { data?: { properties?: Record<string, { properties?: Record<string, unknown> }> } };
    }).properties?.data?.properties;
    assert.ok(data, `${toolName} must expose structured data`);
    if (!field) return data as Record<string, unknown>;
    const nested = data[field]?.properties;
    assert.ok(nested, `${toolName}.${field} must expose structured fields`);
    return nested;
  };

  for (const name of ["create_universe_node", "update_universe_node"] as const) {
    const node = nestedProperties(name, "node");
    assert.ok("created_at" in node);
    assert.ok("updated_at" in node);
    assert.equal("createdAt" in node, false);
    assert.equal("updatedAt" in node, false);
  }

  const detail = nestedProperties("get_universe_node");
  assert.ok("created_at" in detail);
  assert.ok("updated_at" in detail);
  assert.equal("createdAt" in detail, false);
  assert.equal("updatedAt" in detail, false);
  assert.match(String((detail.importance as { description?: string }).description ?? ""), /not writable through the MCP surface/iu);
  assert.match(String((detail.migration as { description?: string }).description ?? ""), /not writable through the MCP surface/iu);

  const listUniverse = nestedProperties("list_universe_nodes");
  const listNode = (listUniverse.nodes as { items?: { properties?: Record<string, unknown> } }).items?.properties;
  assert.ok(listNode);
  assert.match(String((listNode.importance as { description?: string }).description ?? ""), /not writable through the MCP surface/iu);

  for (const name of ["create_universe_relation", "update_universe_relation"] as const) {
    const relation = nestedProperties(name, "relation");
    assert.ok("created_at" in relation);
    assert.equal("createdAt" in relation, false);
  }
});

test("large detail reads expose one bounded continuation contract", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  for (const name of [
    "get_diary",
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
    "create_diary",
    "update_diary",
    "add_diary_comment",
    "update_diary_comment",
    "delete_diary_comment",
    "replace_todo_paper",
    "append_todo_entries",
    "append_todo_entry",
    "update_todo_entry",
    "delete_todo_entry",
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

test("global_search runtime defaults cannot reintroduce retired modules", async () => {
  let captured: Record<string, unknown> | undefined;
  const server = createMcpServer({
    globalSearch: {
      getAuthenticatedUserId: () => "00000000-0000-4000-8000-000000000099",
      globalSearchService: {
        async search(input: Record<string, unknown>) {
          captured = input;
          return {
            results: [],
            metadata: {
              count: 0,
              has_more: false,
              next_cursor: null,
              searched_modules: input.modules as ["diary", "todo", "universe"],
              searched_scope: "active" as const,
            },
          };
        },
      },
    },
  } as never);

  const client = new Client(
    { name: "global-search-retirement-defaults", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({
      name: "global_search",
      arguments: { query: "needle" },
    });
    assert.notEqual(result.isError, true);
    assert.deepEqual(captured?.modules, ["diary", "todo", "universe"]);
  } finally {
    await client.close();
    await server.close();
  }
});

