import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { MemoryDomainError } from "../src/domains/memory/memory-service.js";
import { UpdateMemoryAuthenticationError } from "../src/mcp/tools/update-memory/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

const memory = {
  id: "00000000-0000-4000-8000-000000000201",
  category: "goal" as const,
  key: "focus",
  content: "Updated",
  tags: [],
  source: "mcp",
  updated_at: "2026-08-20T00:00:00.000Z",
  lifecycle_status: "active" as const,
  author: "L" as const,
};

const diary = {
  id: "00000000-0000-4000-8000-000000000202",
  title: "Updated diary",
  content: "Updated body",
  date: "2026-08-20",
  tags: [],
  mood: null,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  lifecycle_status: "active" as const,
  author: "G" as const,
};

const task = {
  id: "00000000-0000-0000-0000-000000000203",
  title: "Updated task",
  description: "Updated description",
  status: "pending" as const,
  priority: "normal" as const,
  due_time: null,
  timezone: "Asia/Shanghai",
  time_bucket: "no_due_date" as const,
  tags: [],
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  completed_at: null,
  allowed_actions: ["start", "cancel"] as const,
  lifecycle_status: "active" as const,
  author: "L" as const,
};

type ConnectOptions = {
  memoryAuthError?: Error;
  memoryError?: Error;
};

async function connect(options: ConnectOptions = {}) {
  const calls = { memory: [] as unknown[], diary: [] as unknown[], task: [] as unknown[], transition: [] as unknown[] };
  const auth = { memory: 0, diary: 0, task: 0 };
  const server = createMcpServer({
    updateMemory: {
      getAuthenticatedUserId: () => { auth.memory += 1; if (options.memoryAuthError) throw options.memoryAuthError; return USER_ID; },
      memoryService: {
        async updateMcpMemory(context, input) {
          if (options.memoryError) throw options.memoryError;
          calls.memory.push({ context, input });
          return memory;
        },
      },
    },
    updateDiary: {
      getAuthenticatedUserId: () => { auth.diary += 1; return USER_ID; },
      diaryService: {
        async updateMcpDiary(context, input) {
          calls.diary.push({ context, input });
          return diary;
        },
      },
    },
    updateTask: {
      getAuthenticatedUserId: () => { auth.task += 1; return USER_ID; },
      taskService: {
        async updateMcpTask(context, input) {
          calls.task.push({ context, input });
          return task;
        },
      },
    },
    transitionTask: {
      getAuthenticatedUserId: () => { auth.task += 1; return USER_ID; },
      taskService: {
        async transitionMcpTask(context, input) {
          calls.transition.push({ context, input });
          return { ...task, status: "in_progress" as const, allowed_actions: ["complete", "cancel"] as const };
        },
      },
    },
  });
  const client = new Client({ name: "mcp-resource-update-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls, auth };
}

test("resource update tools expose strict destructive non-idempotent contracts", async (t) => {
  const { client, server } = await connect();
  t.after(async () => { await client.close(); await server.close(); });
  const tools = (await client.listTools()).tools;
  for (const name of ["update_memory", "update_diary", "update_task", "transition_task"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    const description = tool.description ?? "";
    const expectedReadback = name === "update_memory" || name === "update_diary" ? `get_${name.slice("update_".length)}` : "get_task";
    assert.match(description, new RegExp(expectedReadback));
    assert.match(description, /uncertain/i);
    assert.match(description, /readback/i);
    assert.match(description, /blind(?:ly)?\s+(?:retry|repeat)|retry.*without.*read/i);
    if (name === "transition_task") assert.match(description, /same action|repeat/i);
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("idempotency_key" in (tool.inputSchema.properties ?? {}), false);
  }
  const taskProperties = tools.find((tool) => tool.name === "update_task")?.inputSchema.properties ?? {};
  assert.equal("status" in taskProperties, false);
  assert.equal("timezone" in taskProperties, false);
});

test("resource update MCP schemas expose their object fields through tools/list", async (t) => {
  const { client, server } = await connect();
  t.after(async () => { await client.close(); await server.close(); });
  const tools = (await client.listTools()).tools;
  const expected = {
    update_memory: ["author", "category", "content", "id", "key", "tags"],
    update_diary: ["author", "content", "date", "id", "mood", "tags", "title"],
    update_task: ["author", "description", "due_time", "id", "priority", "tags", "title"],
  } as const;
  for (const [name, fields] of Object.entries(expected)) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool);
    assert.equal(tool.inputSchema.type, "object");
    assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [...fields].sort());
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test("resource update tools preserve partial patch presence and authenticated context", async (t) => {
  const { client, server, calls, auth } = await connect();
  t.after(async () => { await client.close(); await server.close(); });
  const memoryResponse = await client.callTool({ name: "update_memory", arguments: { id: memory.id, content: "Updated", tags: [] } });
  const diaryResponse = await client.callTool({ name: "update_diary", arguments: { id: diary.id, mood: null, tags: [] } });
  const taskResponse = await client.callTool({ name: "update_task", arguments: { id: task.id, due_time: null } });
  const transitionResponse = await client.callTool({ name: "transition_task", arguments: { id: task.id, action: "start" } });
  assert.equal(memoryResponse.isError, undefined);
  assert.equal(diaryResponse.isError, undefined);
  assert.equal(taskResponse.isError, undefined);
  assert.equal(transitionResponse.isError, undefined);
  assert.deepEqual(calls.memory[0], { context: { userId: USER_ID }, input: { id: memory.id, content: "Updated", tags: [] } });
  assert.deepEqual(calls.diary[0], { context: { userId: USER_ID }, input: { id: diary.id, mood: null, tags: [] } });
  assert.deepEqual(calls.task[0], { context: { userId: USER_ID }, input: { id: task.id, dueTime: null } });
  assert.deepEqual(calls.transition[0], { context: { userId: USER_ID }, input: { id: task.id, action: "start" } });
  assert.deepEqual(auth, { memory: 1, diary: 1, task: 2 });
  assert.equal((memoryResponse.structuredContent as { data: typeof memory }).data.lifecycle_status, "active");
});

test("resource update schemas reject empty patches and forbidden fields before service calls", async (t) => {
  const { client, server, calls, auth } = await connect();
  t.after(async () => { await client.close(); await server.close(); });
  for (const name of ["update_memory", "update_diary", "update_task"] as const) {
    const response = await client.callTool({ name, arguments: { id: "resource-id" } });
    assert.equal(response.isError, true);
  }
  for (const name of ["update_memory", "update_diary", "update_task"] as const) {
    for (const field of ["user_id", "userId", "idempotency_key", "idempotencyKey"] as const) {
      const forbidden = await client.callTool({ name, arguments: { id: "resource", content: "patch", [field]: "forbidden" } });
      assert.equal(forbidden.isError, true, `${name} should reject ${field}`);
    }
  }
  for (const field of ["user_id", "userId", "idempotency_key", "idempotencyKey"] as const) {
    const forbidden = await client.callTool({ name: "transition_task", arguments: { id: "task", action: "start", [field]: "forbidden" } });
    assert.equal(forbidden.isError, true, `transition_task should reject ${field}`);
  }
  const forbiddenStatus = await client.callTool({ name: "update_task", arguments: { id: "task", status: "completed" } });
  assert.equal(forbiddenStatus.isError, true);
  const invalidAction = await client.callTool({ name: "transition_task", arguments: { id: "task", action: "pause" } });
  assert.equal(invalidAction.isError, true);
  assert.equal(calls.memory.length, 0);
  assert.equal(calls.diary.length, 0);
  assert.equal(calls.task.length, 0);
  assert.equal(calls.transition.length, 0);
  assert.deepEqual(auth, { memory: 1, diary: 1, task: 1 });
});

test("resource update tools safely map auth and domain failures without leaking details", async () => {
  const authPair = await connect({ memoryAuthError: new UpdateMemoryAuthenticationError() });
  const authResponse = await authPair.client.callTool({ name: "update_memory", arguments: { id: memory.id, content: "next" } });
  assert.equal(authResponse.isError, true);
  assert.match(String(authResponse.content?.[0]?.text), /Authentication is required/);
  await authPair.client.close();
  await authPair.server.close();

  const domainPair = await connect({ memoryError: new MemoryDomainError("MEMORY_NOT_FOUND", "private record details") });
  const domainResponse = await domainPair.client.callTool({ name: "update_memory", arguments: { id: memory.id, content: "next" } });
  assert.equal(domainResponse.isError, true);
  assert.match(String(domainResponse.content?.[0]?.text), /not found/);
  assert.equal(String(domainResponse.content?.[0]?.text).includes("private record details"), false);
  await domainPair.client.close();
  await domainPair.server.close();
});
