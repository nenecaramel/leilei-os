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
    search_memory: 50,
    search_diary: 50,
    list_tasks: 50,
    search_todo: 50,
    list_universe_nodes: 25,
    search_universe: 10,
    list_shared_paper_edits: 50,
  };
  for (const [name, expected] of Object.entries(expectedLimits)) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} must stay registered`);
    assert.equal(property(tool, "limit").default, expected);
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
  ] as const;

  for (const [name, detailTool] of dedicatedDiscovery) {
    const tool = byName.get(name);
    assert.ok(tool?.description, `${name} must have routing guidance`);
    assert.match(tool.description, new RegExp(detailTool, "iu"));
  }

  const writeTodo = byName.get("write_todo_paper");
  assert.ok(writeTodo?.description);
  for (const entryTool of ["append_todo_entry", "update_todo_entry", "delete_todo_entry"]) {
    assert.match(writeTodo.description, new RegExp(entryTool, "iu"));
    assert.ok(byName.has(entryTool), `${entryTool} must stay registered`);
  }
  assert.match(byName.get("append_todo_entry")?.description ?? "", /does not require the paper revision/iu);
  assert.match(byName.get("update_todo_entry")?.description ?? "", /only that entry revision is compared/iu);
  assert.match(byName.get("delete_todo_entry")?.description ?? "", /only that entry revision is compared/iu);
});

test("operational connectivity stays out of the model-visible tool inventory", async () => {
  const tools = await listTools(createMcpServer({} as never));
  const names = tools.map((tool) => tool.name);
  assert.equal(names.includes("hello"), false);
});
