import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CreateDiaryResult } from "../src/domains/diary/diary-service.js";
import type { CreateTaskResult } from "../src/domains/task/task-service.js";
import type { ToyCommandRecord } from "../src/domains/toy/toy-command-types.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { MCP_WRITE_TOOL_NAMES } from "../src/mcp/tools/write-context.js";

const AUTHENTICATED_USER_ID = "00000000-0000-4000-8000-000000000099";

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
      created_at: "2026-08-01T00:00:00.000Z",
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
  const authCalls = { task: 0, diary: 0, toy: 0 };
  const taskCalls: unknown[] = [];
  const diaryCalls: unknown[] = [];
  const toyCalls: unknown[] = [];

  const server = createMcpServer({
    createTask: {
      getAuthenticatedUserId: () => {
        authCalls.task += 1;
        return AUTHENTICATED_USER_ID;
      },
      taskService: {
        async createTask(context, input) {
          taskCalls.push({ context, input });
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
        async createDiary(context, input) {
          diaryCalls.push({ context, input });
          if (failure) throw failure;
          return diaryResult();
        },
      },
    },
    toyCommand: {
      getAuthenticatedUserId: () => {
        authCalls.toy += 1;
        return AUTHENTICATED_USER_ID;
      },
      toyCommandService: {
        async create(userId, input) {
          toyCalls.push({ userId, input });
          if (failure) throw failure;
          const command = input as { action: "set" | "stop"; percent?: number };
          return toyResult(command.action, command.action === "set" ? command.percent! : null);
        },
      },
    },
  });

  return { server, authCalls, taskCalls, diaryCalls, toyCalls };
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
      },
    }),
    client.callTool({
      name: "write_diary",
      arguments: {
        title: "Diary title",
        content: "Diary content",
        date: "2026-08-01",
        tags: [],
        idempotency_key: "diary-20260801-contract",
      },
    }),
    client.callTool({ name: "toy_set", arguments: { percent: 20 } }),
    client.callTool({ name: "toy_stop", arguments: {} }),
  ]);
}

test("MCP exposes exactly four write tools and preserves every annotation", async (t) => {
  const { client, server } = await connect();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = (await client.listTools()).tools;
  const writes = tools.filter((tool) => tool.annotations?.readOnlyHint === false);
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

  assert.equal(tools.find((tool) => tool.name === "create_task")?.annotations?.destructiveHint, false);
  assert.equal(tools.find((tool) => tool.name === "write_diary")?.annotations?.idempotentHint, true);
  for (const name of ["toy_set", "toy_stop"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.equal(tool?.annotations?.destructiveHint, true);
    assert.equal(tool?.annotations?.idempotentHint, false);
  }
});

test("each write resolves server identity once and invokes its service once", async (t) => {
  const { client, server, authCalls, taskCalls, diaryCalls, toyCalls } = await connect();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const responses = await invokeAllWrites(client);
  assert.equal(responses.every((response) => response.isError !== true), true);
  assert.deepEqual(authCalls, { task: 1, diary: 1, toy: 2 });
  assert.equal(taskCalls.length, 1);
  assert.equal(diaryCalls.length, 1);
  assert.equal(toyCalls.length, 2);
  assert.deepEqual(taskCalls[0] && (taskCalls[0] as { context: unknown }).context, { userId: AUTHENTICATED_USER_ID });
  assert.deepEqual(diaryCalls[0] && (diaryCalls[0] as { context: unknown }).context, { userId: AUTHENTICATED_USER_ID });
  assert.deepEqual(toyCalls.map((call) => (call as { userId: string }).userId), [
    AUTHENTICATED_USER_ID,
    AUTHENTICATED_USER_ID,
  ]);
});

test("unexpected identity arguments are rejected before authentication or writes", async (t) => {
  const { client, server, authCalls, taskCalls, diaryCalls, toyCalls } = await connect();
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
    { name: "toy_set", arguments: { percent: 20, user_id: "attacker" } },
    { name: "toy_stop", arguments: { user_id: "attacker" } },
  ];

  for (const attempt of attempts) {
    const response = await client.callTool(attempt);
    assert.equal(response.isError, true);
  }

  assert.deepEqual(authCalls, { task: 0, diary: 0, toy: 0 });
  assert.equal(taskCalls.length, 0);
  assert.equal(diaryCalls.length, 0);
  assert.equal(toyCalls.length, 0);
});

test("write failures are safe and never retried automatically", async (t) => {
  const internalFailure = new Error("private SQL and device transport detail");
  const { client, server, authCalls, taskCalls, diaryCalls, toyCalls } = await connect(internalFailure);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const responses = await invokeAllWrites(client);
  for (const response of responses) {
    assert.equal(response.isError, true);
    assert.doesNotMatch(JSON.stringify(response), /private SQL|device transport detail/);
  }
  assert.deepEqual(authCalls, { task: 1, diary: 1, toy: 2 });
  assert.equal(taskCalls.length, 1);
  assert.equal(diaryCalls.length, 1);
  assert.equal(toyCalls.length, 2);
});
