import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { registerReadNotionPageTool } from "../src/mcp/tools/read-notion-page/register.js";
import { registerSearchNotionTool } from "../src/mcp/tools/search-notion/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const MEMORY_ID = "00000000-0000-4000-8000-000000000301";
const DIARY_ID = "00000000-0000-4000-8000-000000000302";
const TASK_ID = "contract-task-id";
const NOTION_PAGE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NODE_ID = "node-contract";
const HUGE_BODY = `BODY_SENTINEL_${"x".repeat(100_000)}`;

async function connectServer(server: McpServer, name: string) {
  const client = new Client({ name, version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function dataOf(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  const structured = result.structuredContent as { success?: boolean; data?: Record<string, unknown> } | undefined;
  assert.equal(structured?.success, true);
  assert.ok(structured?.data);
  return structured.data;
}

function memory(body: string, lifecycleStatus: "active" | "archived" = "active") {
  return {
    id: MEMORY_ID,
    category: "goal" as const,
    key: "phase_one_contract",
    content: body,
    tags: ["mcp"],
    source: "mcp",
    lifecycle_status: lifecycleStatus,
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:01.000Z",
    author: "L" as const,
  };
}

function diary(body: string) {
  return {
    id: DIARY_ID,
    title: "Phase 1 contract",
    content: body,
    date: "2026-08-26",
    tags: ["mcp"],
    mood: null,
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:01.000Z",
    lifecycle_status: "active" as const,
    author: "G" as const,
  };
}

function universeNode(body: string) {
  return {
    id: NODE_ID,
    title: "Phase 1 node",
    summary: "summary",
    content: body,
    type: "concept",
    tags: ["mcp"],
    galaxies: [{ id: "contract", weight: 1 }],
    position: { x: 10, y: 20 },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:01.000Z",
  };
}

async function collectMutationReceipts(body: string) {
  const memoryValue = memory(body);
  const diaryValue = diary(body);
  const nodeValue = universeNode(body);
  const server = createMcpServer({
    writeMemory: {
      getAuthenticatedUserId: () => USER_ID,
      memoryService: {
        async createMcpMemory() {
          return { memory: memoryValue, metadata: { created: true, idempotent_replay: false } };
        },
      },
    },
    updateMemory: {
      getAuthenticatedUserId: () => USER_ID,
      memoryService: { async updateMcpMemory() { return memoryValue; } },
    },
    updateDiary: {
      getAuthenticatedUserId: () => USER_ID,
      diaryService: { async updateMcpDiary() { return diaryValue; } },
    },
    universeWriteTools: {
      getAuthenticatedUserId: () => USER_ID,
      nodeService: {
        async createMcpNode() {
          return { node: nodeValue, universe_version: 11, metadata: { created: true, idempotent_replay: false } };
        },
        async updateMcpNode() {
          return { snapshot: { nodes: [nodeValue] }, version: 12 };
        },
      },
      relationService: { async createMcpRelation() { throw new Error("not used"); } },
    },
  } as never);
  const pair = await connectServer(server, "mcp-response-contract-mutations");
  try {
    const writeMemory = await pair.client.callTool({
      name: "write_memory",
      arguments: {
        category: "goal",
        key: "phase_one_contract",
        content: "request body",
        tags: ["mcp"],
        author: "L",
        idempotency_key: "phase-one-memory-write-0001",
      },
    });
    const updateMemory = await pair.client.callTool({
      name: "update_memory",
      arguments: { id: MEMORY_ID, content: "request patch" },
    });
    const updateDiary = await pair.client.callTool({
      name: "update_diary",
      arguments: { id: DIARY_ID, content: "request patch" },
    });
    const createUniverseNode = await pair.client.callTool({
      name: "create_universe_node",
      arguments: {
        title: "Phase 1 node",
        summary: "summary",
        content: "request body",
        type: "concept",
        tags: ["mcp"],
        galaxies: [{ id: "contract", weight: 1 }],
        position: { x: 10, y: 20 },
        expected_version: 10,
        idempotency_key: "phase-one-node-create-0001",
      },
    });
    const updateUniverseNode = await pair.client.callTool({
      name: "update_universe_node",
      arguments: { id: NODE_ID, expected_version: 11, content: "request patch" },
    });
    return { writeMemory, updateMemory, updateDiary, createUniverseNode, updateUniverseNode };
  } finally {
    await pair.client.close();
    await pair.server.close();
  }
}

function assertNoBodyEcho(result: Awaited<ReturnType<Client["callTool"]>>, sentinel: string) {
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(sentinel), false, "mutation receipt must not echo the service-layer semantic body");
}

test("five long-body mutation tools return compact exact-detail receipts with bounded growth", async () => {
  const tiny = await collectMutationReceipts("tiny");
  const huge = await collectMutationReceipts(HUGE_BODY);

  for (const name of Object.keys(huge) as Array<keyof typeof huge>) {
    assertNoBodyEcho(huge[name], HUGE_BODY);
    assert.ok(
      serializedBytes(huge[name]) - serializedBytes(tiny[name]) <= 1024,
      `${name} response grew with the service-layer body`,
    );
  }

  assert.deepEqual(dataOf(huge.writeMemory), {
    memory: {
      id: MEMORY_ID,
      category: "goal",
      key: "phase_one_contract",
      tags: ["mcp"],
      source: "mcp",
      lifecycle_status: "active",
      created_at: "2026-08-26T00:00:00.000Z",
      updated_at: "2026-08-26T00:00:01.000Z",
      author: "L",
    },
    metadata: { created: true, idempotent_replay: false },
    detail_tool: "get_memory",
    detail_arguments: { id: MEMORY_ID, scope: "active" },
  });
  assert.deepEqual(dataOf(huge.updateMemory), {
    id: MEMORY_ID,
    category: "goal",
    key: "phase_one_contract",
    tags: ["mcp"],
    source: "mcp",
    updated_at: "2026-08-26T00:00:01.000Z",
    lifecycle_status: "active",
    author: "L",
    detail_tool: "get_memory",
    detail_arguments: { id: MEMORY_ID, scope: "active" },
  });
  assert.deepEqual(dataOf(huge.updateDiary), {
    id: DIARY_ID,
    title: "Phase 1 contract",
    date: "2026-08-26",
    tags: ["mcp"],
    mood: null,
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:01.000Z",
    lifecycle_status: "active",
    author: "G",
    detail_tool: "get_diary",
    detail_arguments: { id: DIARY_ID, scope: "active" },
  });
  assert.deepEqual(dataOf(huge.createUniverseNode), {
    node: {
      id: NODE_ID,
      title: "Phase 1 node",
      type: "concept",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:01.000Z",
    },
    universe_version: 11,
    metadata: { created: true, idempotent_replay: false },
    detail_tool: "get_universe_node",
    detail_arguments: { id: NODE_ID },
  });
  assert.deepEqual(dataOf(huge.updateUniverseNode), {
    node: {
      id: NODE_ID,
      title: "Phase 1 node",
      type: "concept",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:01.000Z",
    },
    universe_version: 12,
    detail_tool: "get_universe_node",
    detail_arguments: { id: NODE_ID },
  });
});

test("archived write_memory replay points to archived exact detail", async (t) => {
  const archived = memory("archived body", "archived");
  const server = createMcpServer({
    writeMemory: {
      getAuthenticatedUserId: () => USER_ID,
      memoryService: {
        async createMcpMemory() {
          return { memory: archived, metadata: { created: false, idempotent_replay: true } };
        },
      },
    },
  } as never);
  const pair = await connectServer(server, "mcp-response-contract-archived-memory");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });
  const result = await pair.client.callTool({
    name: "write_memory",
    arguments: {
      category: "goal",
      key: "phase_one_contract",
      content: "archived body",
      author: "L",
      idempotency_key: "phase-one-memory-archived-0001",
    },
  });
  const data = dataOf(result);
  assert.equal(data.detail_tool, "get_memory");
  assert.deepEqual(data.detail_arguments, { id: MEMORY_ID, scope: "archived" });
  assert.equal(JSON.stringify(data).includes('"content"'), false);
});

test("Task and Notion discovery results expose deterministic exact-detail pointers", async (t) => {
  const task = {
    id: TASK_ID,
    title: "Phase 1 task",
    description: "full task body",
    status: "pending" as const,
    priority: "normal" as const,
    due_time: null,
    timezone: "Asia/Shanghai",
    time_bucket: "no_due_date" as const,
    tags: ["mcp"],
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:01.000Z",
    completed_at: null,
    allowed_actions: ["start", "cancel"] as const,
    author: "L" as const,
  };
  const taskServer = createMcpServer({
    taskTools: {
      getAuthenticatedUserId: () => USER_ID,
      taskService: {
        async listTasks() { return { tasks: [task], metadata: { count: 1 } }; },
        async readTask() { return task; },
      },
    },
  } as never);
  const taskPair = await connectServer(taskServer, "mcp-response-contract-task");
  t.after(async () => { await taskPair.client.close(); await taskPair.server.close(); });
  const taskResult = await taskPair.client.callTool({ name: "list_tasks", arguments: {} });
  const taskData = dataOf(taskResult) as { tasks: Array<Record<string, unknown>> };
  assert.deepEqual(taskData.tasks[0]?.detail_arguments, { id: TASK_ID });
  assert.equal(taskData.tasks[0]?.detail_tool, "get_task");
  assert.equal(JSON.stringify(taskData.tasks[0]).includes("full task body"), false);

  const notionService = {
    async searchPages() {
      return {
        results: [{
          id: NOTION_PAGE_ID,
          title: "Phase 1",
          url: "https://www.notion.so/phase-one",
          last_edited_time: "2026-08-26T00:00:00.000Z",
        }],
        metadata: { count: 1, has_more: false, next_cursor: null },
      };
    },
    async readPage() { throw new Error("not used"); },
  };
  const notionServer = new McpServer({ name: "mcp-response-contract-notion", version: "1.0.0" });
  registerSearchNotionTool(notionServer, { notionService, getAuthenticatedUserId: () => USER_ID } as never);
  registerReadNotionPageTool(notionServer, { notionService, getAuthenticatedUserId: () => USER_ID } as never);
  const notionPair = await connectServer(notionServer, "mcp-response-contract-notion-client");
  t.after(async () => { await notionPair.client.close(); await notionPair.server.close(); });
  const notionResult = await notionPair.client.callTool({ name: "search_notion", arguments: { query: "Phase 1" } });
  const notionData = dataOf(notionResult) as { results: Array<Record<string, unknown>> };
  assert.equal(notionData.results[0]?.detail_tool, "read_notion_page");
  assert.deepEqual(notionData.results[0]?.detail_arguments, { page_id: NOTION_PAGE_ID });
});

test("routing descriptions align with executable schemas and the MCP inventory remains complete", async (t) => {
  const server = createMcpServer({} as never);
  const pair = await connectServer(server, "mcp-response-contract-descriptions");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });
  const tools = (await pair.client.listTools()).tools;
  // The current production registration exposes the accepted core surface.
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  assert.ok(byName.has("search_conversations"));
  assert.ok(byName.has("read_conversation"));
  assert.ok(byName.has("list_conversation_exclusions"));
  assert.ok(byName.has("inspect_conversation_restore_candidates"));
  assert.ok(byName.has("inspect_conversation_restore_path"));
  assert.ok(byName.has("restore_conversation_exclusion"));

  const createTask = byName.get("create_task");
  assert.ok(createTask?.inputSchema.required?.includes("idempotency_key"));
  assert.equal(createTask?.annotations?.idempotentHint, true);
  assert.match(createTask?.description ?? "", /idempotent|replay/i);
  assert.doesNotMatch(createTask?.description ?? "", /non[-_ ]?idempotent/i);

  const toyStop = byName.get("toy_stop");
  assert.ok(toyStop?.inputSchema.required?.includes("idempotency_key"));
  assert.match(toyStop?.description ?? "", /idempotency_key/i);
  assert.doesNotMatch(toyStop?.description ?? "", /accepts? no (?:arguments|parameters)|no arguments|no parameters/i);

  assert.match(byName.get("global_search")?.description ?? "", /domain.*(?:unknown|unsure)|unknown.*domain/i);
  assert.match(byName.get("global_search")?.description ?? "", /prefer.*(?:domain|specific)|domain.*(?:search|tool)/i);
  assert.match(byName.get("get_universe_relations")?.description ?? "", /known|exact/i);
  assert.match(byName.get("write_memory")?.description ?? "", /archived.*get_memory|get_memory.*archived/i);

  const routingChecks: Array<[string, RegExp[]]> = [
    ["global_search", [/Memory|Diary|Task|Universe/i, /domain/i, /detail/i]],
    ["read_memory", [/search_memory/i, /get_memory/i]],
    ["search_memory", [/read_memory/i, /get_memory/i]],
    ["get_memory", [/exact/i, /full/i]],
    ["search_diary", [/get_diary/i]],
    ["get_diary", [/exact/i, /full/i]],
    ["list_tasks", [/get_task/i]],
    ["get_task", [/exact/i, /detail/i]],
    ["list_universe_nodes", [/search_universe/i, /get_universe_node/i]],
    ["search_universe", [/list_universe_nodes/i, /get_universe_node/i]],
    ["get_universe_node", [/exact/i, /full/i]],
    ["search_notion", [/title/i, /read_notion_page/i]],
    ["read_notion_page", [/exact/i]],
    ["list_todo_dates", [/read_todo_day/i]],
  ];
  for (const [name, patterns] of routingChecks) {
    const description = byName.get(name)?.description ?? "";
    for (const pattern of patterns) assert.match(description, pattern, `${name} description should match ${pattern}`);
  }
});

test("weather context keeps the key weather values in content and the canonical payload in structuredContent", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    current: {
      temperature_2m: 26,
      relative_humidity_2m: 70,
      weather_code: 0,
      wind_speed_10m: 3,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
  t.after(() => { globalThis.fetch = originalFetch; });

  const server = createMcpServer({} as never);
  const pair = await connectServer(server, "mcp-response-contract-context");
  t.after(async () => { await pair.client.close(); await pair.server.close(); });

  const result = await pair.client.callTool({ name: "get_weather_context", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 1);
  const first = result.content[0];
  assert.ok(first && "text" in first);
  const text = String(first.text);
  assert.match(text, /山东临沂/);
  assert.match(text, /26/);
  assert.match(text, /70/);
  assert.match(text, /3/);
  assert.ok(text.length < 80);
  assert.equal(text.trimStart().startsWith("{"), false);
  assert.equal(text.includes(JSON.stringify(result.structuredContent)), false);
});
