import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

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

async function connect() {
  const calls = { memory: [] as unknown[], diary: [] as unknown[], task: [] as unknown[], transition: [] as unknown[] };
  const auth = { memory: 0, diary: 0, task: 0 };
  const server = createMcpServer({
    updateMemory: {
      getAuthenticatedUserId: () => { auth.memory += 1; return USER_ID; },
      memoryService: {
        async updateMcpMemory(context, input) {
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
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("idempotency_key" in (tool.inputSchema.properties ?? {}), false);
  }
  const taskProperties = tools.find((tool) => tool.name === "update_task")?.inputSchema.properties ?? {};
  assert.equal("status" in taskProperties, false);
  assert.equal("timezone" in taskProperties, false);
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
  const forbidden = await client.callTool({ name: "update_task", arguments: { id: "task", status: "completed" } });
  assert.equal(forbidden.isError, true);
  assert.equal(calls.memory.length, 0);
  assert.equal(calls.diary.length, 0);
  assert.equal(calls.task.length, 0);
  assert.deepEqual(auth, { memory: 0, diary: 0, task: 0 });
});
