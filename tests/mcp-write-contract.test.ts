import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CreateDiaryResult } from "../src/domains/diary/diary-service.js";
import type { CreateTaskResult } from "../src/domains/task/task-service.js";
import type { CreateMcpMemoryResult } from "../src/domains/memory/memory-service.js";
import type { ToyCommandRecord } from "../src/domains/toy/toy-command-types.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { MCP_WRITE_TOOL_NAMES } from "../src/mcp/tools/write-context.js";

const AUTHENTICATED_USER_ID = "00000000-0000-4000-8000-000000000099";

const TODO_PAPER = {
  date: "2026-08-13",
  author: "L" as const,
  revision: 1,
  entries: [{ id: "todo-contract-row", kind: "pending" as const, text: "Todo contract" }],
};

function taskResult(): CreateTaskResult {
  return {
    task: {
      id: "00000000-0000-4000-8000-000000000101",
      title: "Task title",
      description: "Task description",
      status: "pending",
      priority: "normal",
      due_time: null,
      timezone: "Asia/Shanghai",
      time_bucket: "no_due_date",
      tags: [],
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      completed_at: null,
      author: "L",
    },
  };
}

function diaryResult(): CreateDiaryResult {
  return {
    diary: {
      id: "00000000-0000-4000-8000-000000000102",
      title: "Diary title",
      date: "2026-08-01",
      tags: [],
      mood: null,
      author: "G",
      created_at: "2026-08-01T00:00:00.000Z",
    },
    metadata: { created: true, idempotent_replay: false },
  };
}

function memoryResult(): CreateMcpMemoryResult {
  return {
    memory: {
      id: "00000000-0000-4000-8000-000000000105",
      category: "goal",
      key: "confirmed_goal",
      content: "Confirmed content",
      tags: ["confirmed"],
      source: "mcp",
      lifecycle_status: "active",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      author: "L",
    },
    metadata: { created: true, idempotent_replay: false },
  };
}

function toyResult(action: "set" | "stop", percent: number | null): ToyCommandRecord {
  return {
    id: action === "set"
      ? "00000000-0000-4000-8000-000000000103"
      : "00000000-0000-4000-8000-000000000104",
    userId: AUTHENTICATED_USER_ID,
    action,
    percent,
    durationSeconds: action === "set" ? 60 : null,
    status: "pending",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2026-08-01T00:00:10.000Z"),
    claimedAt: null,
    completedAt: null,
    expiredAt: null,
    error: null,
  };
}

function createFixture(failure?: Error) {
  const authCalls = { task: 0, diary: 0, memory: 0, toy: 0, todo: 0 };
  const taskCalls: unknown[] = [];
  const diaryCalls: unknown[] = [];
  const memoryCalls: unknown[] = [];
  const toyCalls: unknown[] = [];
  const todoCalls: unknown[] = [];

  const dependencies = {
    createTask: {
      getAuthenticatedUserId: () => {
        authCalls.task += 1;
        return AUTHENTICATED_USER_ID;
      },
      taskService: {
        async createTaskIdempotently(context, input, idempotencyKey) {
          taskCalls.push({ context, input, idempotencyKey });
          if (failure) throw failure;
          return taskResult();
        },
      },
    },
    writeDiary: {
      getAuthenticatedUserId: () => {
        authCalls.diary += 1;
        return AUTHENTICATED_USER_ID;
      },
      diaryService: {
        async createMcpDiary(context, input) {
          diaryCalls.push({ context, input });
          if (failure) throw failure;
          return diaryResult();
        },
      },
    },
    writeMemory: {
      getAuthenticatedUserId: () => {
        authCalls.memory += 1;
        return AUTHENTICATED_USER_ID;
      },
      memoryService: {
        async createMcpMemory(context, input, idempotencyKey) {
          memoryCalls.push({ context, input, idempotencyKey });
          if (failure) throw failure;
          return memoryResult();
        },
      },
    },
    toyCommand: {
      getAuthenticatedUserId: () => {
        authCalls.toy += 1;
        return AUTHENTICATED_USER_ID;
      },
      toyCommandService: {
        async createIdempotently(userId, input, idempotencyKey) {
          toyCalls.push({ userId, input, idempotencyKey });
          if (failure) throw failure;
          const command = input as { action: "set" | "stop"; percent?: number };
          return toyResult(command.action, command.action === "set" ? command.percent! : null);
        },
      },
    },
    todoTools: {
      getAuthenticatedUserId: () => {
        authCalls.todo += 1;
        return AUTHENTICATED_USER_ID;
      },
      todoService: {
        async readDay() {
          return { date: TODO_PAPER.date, papers: { L: TODO_PAPER, G: null } };
        },
        async listDates() {
          return [TODO_PAPER.date];
        },
        async replacePaperIdempotently(input: unknown) {
          todoCalls.push(input);
          if (failure) throw failure;
          return {
            paper: TODO_PAPER,
            metadata: { committed: true, idempotent_replay: false },
          };
        },
      },
    },
  };
  const server = createMcpServer(dependencies);

  return { server, authCalls, taskCalls, diaryCalls, memoryCalls, toyCalls, todoCalls };
}

async function connect(failure?: Error) {
  const fixture = createFixture(failure);
  const client = new Client(
    { name: "mcp-write-contract-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await fixture.server.connect(serverTransport);
  await client.connect(clientTransport);
  return { ...fixture, client };
}

async function invokeAllWrites(client: Client) {
  return Promise.all([
    client.callTool({
      name: "create_task",
      arguments: {
        title: "Task title",
        description: "Task description",
        priority: "normal",
        tags: [],
        author: "L",
        idempotency_key: "task-contract-20260801",
      },
    }),
    client.callTool({
      name: "write_diary",
      arguments: {
        title: "Diary title",
        content: "Diary content",
        date: "2026-08-01",
        tags: [],
        author: "G",
        idempotency_key: "diary-20260801-contract",
      },
    }),
    client.callTool({
      name: "write_memory",
      arguments: {
        category: "goal",
        key: "confirmed_goal",
        content: "Confirmed content",
        tags: ["confirmed"],
        author: "L",
        idempotency_key: "memory-20260801-contract",
      },
    }),
    client.callTool({ name: "toy_set", arguments: { percent: 20, idempotency_key: "toy-set-contract-20260801" } }),
    client.callTool({ name: "toy_stop", arguments: { idempotency_key: "toy-stop-contract-20260801" } }),
    client.callTool({
      name: "write_todo_paper",
      arguments: {
        date: TODO_PAPER.date,
        author: TODO_PAPER.author,
        revision: null,
        entries: TODO_PAPER.entries,
        idempotency_key: "todo-paper-contract-20260813",
      },
    }),
  ]);
}

test("MCP exposes exactly six write tools and preserves every annotation", async (t) => {
  const { client, server } = await connect();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = (await client.listTools()).tools;
  const writes = tools.filter((tool) => tool.annotations?.readOnlyHint === false);
  assert.deepEqual(MCP_WRITE_TOOL_NAMES, [
    "create_task",
    "write_diary",
    "write_memory",
    "toy_set",
    "toy_stop",
    "write_todo_paper",
  ]);
  assert.deepEqual(
    writes.map((tool) => tool.name).sort(),
    [...MCP_WRITE_TOOL_NAMES].sort(),
  );

  for (const tool of tools) {
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    if (MCP_WRITE_TOOL_NAMES.includes(tool.name as (typeof MCP_WRITE_TOOL_NAMES)[number])) {
      assert.equal(tool.annotations?.openWorldHint, false);
    } else {
      assert.equal(tool.annotations?.readOnlyHint, true);
    }
  }

  for (const name of ["create_task", "write_diary", "write_memory"]) {
    assert.equal(tools.find((tool) => tool.name === name)?.annotations?.destructiveHint, false);
  }
  assert.equal(tools.find((tool) => tool.name === "create_task")?.annotations?.idempotentHint, true);
  assert.equal(tools.find((tool) => tool.name === "write_diary")?.annotations?.idempotentHint, true);
  assert.equal(tools.find((tool) => tool.name === "write_memory")?.annotations?.idempotentHint, true);
  for (const name of ["create_task", "write_diary", "write_memory", "write_todo_paper"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool?.inputSchema.required?.includes("author"));
  }
  for (const tool of tools) {
    if (!["create_task", "write_diary", "write_memory", "write_todo_paper"].includes(tool.name)) {
      assert.equal("author" in (tool.inputSchema.properties ?? {}), false);
    }
  }
  for (const name of ["toy_set", "toy_stop"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.equal(tool?.annotations?.destructiveHint, true);
    assert.equal(tool?.annotations?.idempotentHint, true);
  }
  const todoWrite = tools.find((tool) => tool.name === "write_todo_paper");
  assert.ok(todoWrite);
  assert.deepEqual(todoWrite.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(
    [...(todoWrite.inputSchema.required ?? [])].sort(),
    ["date", "author", "revision", "entries", "idempotency_key"].sort(),
  );
});

test("each write resolves server identity once and invokes its service once", async (t) => {
  const { client, server, authCalls, taskCalls, diaryCalls, memoryCalls, toyCalls, todoCalls } = await connect();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const responses = await invokeAllWrites(client);
  assert.equal(responses.every((response) => response.isError !== true), true);
  assert.deepEqual(authCalls, { task: 1, diary: 1, memory: 1, toy: 2, todo: 1 });
  assert.equal(taskCalls.length, 1);
  assert.equal(diaryCalls.length, 1);
  assert.equal(memoryCalls.length, 1);
  assert.equal(toyCalls.length, 2);
  assert.equal(todoCalls.length, 1);
  assert.deepEqual(taskCalls[0] && (taskCalls[0] as { context: unknown }).context, { userId: AUTHENTICATED_USER_ID });
  assert.deepEqual(diaryCalls[0] && (diaryCalls[0] as { context: unknown }).context, { userId: AUTHENTICATED_USER_ID });
  assert.deepEqual(memoryCalls[0] && (memoryCalls[0] as { context: unknown }).context, { userId: AUTHENTICATED_USER_ID });
  assert.deepEqual(toyCalls.map((call) => (call as { userId: string }).userId), [
    AUTHENTICATED_USER_ID,
    AUTHENTICATED_USER_ID,
  ]);
});

test("unexpected identity arguments are rejected before authentication or writes", async (t) => {
  const { client, server, authCalls, taskCalls, diaryCalls, memoryCalls, toyCalls, todoCalls } = await connect();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const attempts = [
    {
      name: "create_task",
      arguments: {
        title: "Task title",
        description: "Task description",
        priority: "normal",
        tags: [],
        idempotency_key: "task-attacker-20260801",
        user_id: "attacker",
      },
    },
    {
      name: "write_diary",
      arguments: {
        title: "Diary title",
        content: "Diary content",
        date: "2026-08-01",
        tags: [],
        idempotency_key: "diary-20260801-contract",
        user_id: "attacker",
      },
    },
    {
      name: "write_memory",
      arguments: {
        category: "goal",
        key: "confirmed_goal",
        content: "Confirmed content",
        tags: [],
        idempotency_key: "memory-attacker-20260801",
        user_id: "attacker",
      },
    },
    { name: "toy_set", arguments: { percent: 20, idempotency_key: "toy-set-attacker-20260801", user_id: "attacker" } },
    { name: "toy_stop", arguments: { idempotency_key: "toy-stop-attacker-20260801", user_id: "attacker" } },
    {
      name: "write_todo_paper",
      arguments: {
        date: TODO_PAPER.date,
        author: TODO_PAPER.author,
        revision: null,
        entries: TODO_PAPER.entries,
        idempotency_key: "todo-paper-attacker-20260813",
        user_id: "attacker",
      },
    },
  ];

  for (const attempt of attempts) {
    const response = await client.callTool(attempt);
    assert.equal(response.isError, true);
  }

  assert.deepEqual(authCalls, { task: 0, diary: 0, memory: 0, toy: 0, todo: 0 });
  assert.equal(taskCalls.length, 0);
  assert.equal(diaryCalls.length, 0);
  assert.equal(memoryCalls.length, 0);
  assert.equal(toyCalls.length, 0);
  assert.equal(todoCalls.length, 0);
});

test("write failures are safe and never retried automatically", async (t) => {
  const internalFailure = new Error("private SQL and device transport detail");
  const { client, server, authCalls, taskCalls, diaryCalls, memoryCalls, toyCalls, todoCalls } = await connect(internalFailure);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const responses = await invokeAllWrites(client);
  for (const response of responses) {
    assert.equal(response.isError, true);
    assert.doesNotMatch(JSON.stringify(response), /private SQL|device transport detail/);
  }
  assert.deepEqual(authCalls, { task: 1, diary: 1, memory: 1, toy: 2, todo: 1 });
  assert.equal(taskCalls.length, 1);
  assert.equal(diaryCalls.length, 1);
  assert.equal(memoryCalls.length, 1);
  assert.equal(toyCalls.length, 2);
  assert.equal(todoCalls.length, 1);
});
