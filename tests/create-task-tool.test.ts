import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  AuthenticatedTaskContext,
  CreateTaskInput,
  CreateTaskResult,
} from "../src/domains/task/task-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import {
  CreateTaskAuthenticationError,
  type CreateTaskToolDependencies,
} from "../src/mcp/tools/create-task/register.js";

const AUTHENTICATED_USER_ID = "00000000-0000-4000-8000-000000000099";

class MockTaskToolService {
  calls: Array<{
    context: AuthenticatedTaskContext;
    input: CreateTaskInput;
    idempotencyKey: string;
  }> = [];

  async createTaskIdempotently(
    context: AuthenticatedTaskContext,
    input: CreateTaskInput,
    idempotencyKey: string,
  ): Promise<CreateTaskResult> {
    this.calls.push({ context, input, idempotencyKey });

    return {
      task: {
        id: "00000000-0000-4000-8000-000000000010",
        title: input.title,
        description: input.description,
        status: "pending",
        priority: input.priority as "low" | "normal" | "high" | "urgent",
        due_time:
          input.dueTime === null || input.dueTime === undefined
            ? null
            : "2026-07-23T08:30:00.000Z",
        timezone: input.timezone ?? "Asia/Shanghai",
        time_bucket:
          input.dueTime === null || input.dueTime === undefined
            ? "no_due_date"
            : "later",
        tags: [...input.tags],
        created_at: "2026-07-22T09:00:00.000Z",
        updated_at: "2026-07-22T09:00:00.000Z",
        completed_at: null,
        author: input.author ?? null,
      },
    };
  }
}

function createTestDependencies(
  taskService: MockTaskToolService,
  getAuthenticatedUserId: () => string = () => AUTHENTICATED_USER_ID,
) {
  return {
    readMemory: {
      memoryService: {
        readMemory: async () => ({
          user: { display_name: "Leilei" },
          memories: [],
          metadata: { count: 0 },
        }),
      },
      getAuthenticatedUserId: () => AUTHENTICATED_USER_ID,
    },
    writeDiary: {
      diaryService: {
        createMcpDiary: async () => ({
          diary: {
            id: "00000000-0000-4000-8000-000000000001",
            title: "Test diary",
            date: "2026-07-22",
            tags: [],
            mood: null,
            created_at: "2026-07-22T08:00:00.000Z",
          },
          metadata: { created: true, idempotent_replay: false },
        }),
      },
      getAuthenticatedUserId: () => AUTHENTICATED_USER_ID,
    },
    createTask: {
      taskService,
      getAuthenticatedUserId,
    } satisfies CreateTaskToolDependencies,
  };
}

async function connectTestClient(dependencies: ReturnType<typeof createTestDependencies>) {
  const server = createMcpServer(dependencies);
  const client = new Client(
    { name: "create-task-test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

test("create_task calls the mock service with authenticated context", async (t) => {
  const taskService = new MockTaskToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(taskService),
  );
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "create_task",
    arguments: {
      title: "完成 Phase 4",
      description: "完成 create_task MCP Tool 验收。",
      due_time: "2026-07-23T16:30:00+08:00",
      timezone: "Asia/Shanghai",
      priority: "high",
      tags: ["phase4", "MCP"],
      author: "C",
      idempotency_key: "task-20260723-phase4",
    },
  });

  assert.equal(response.isError, undefined);
  assert.deepEqual(taskService.calls, [
    {
      context: { userId: AUTHENTICATED_USER_ID },
      input: {
        title: "完成 Phase 4",
        description: "完成 create_task MCP Tool 验收。",
        dueTime: "2026-07-23T16:30:00+08:00",
        timezone: "Asia/Shanghai",
        priority: "high",
        tags: ["phase4", "MCP"],
        author: "C",
      },
      idempotencyKey: "task-20260723-phase4",
    },
  ]);
  assert.equal(
    (response.structuredContent as { data?: { task?: { status?: string } } })
      .data?.task?.status,
    "pending",
  );
  assert.equal(
    (response.structuredContent as { data?: { task?: { author?: string } } })
      .data?.task?.author,
    "C",
  );
});

test("create_task accepts an omitted due time without bypassing Task Service", async (t) => {
  const taskService = new MockTaskToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(taskService),
  );
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "create_task",
    arguments: {
      title: "开放任务",
      description: "暂时没有截止时间。",
        priority: "normal",
        tags: [],
        author: "G",
      author: "G",
      idempotency_key: "task-20260723-open",
    },
  });

  assert.equal(response.isError, undefined);
  assert.equal(taskService.calls.length, 1);
  assert.equal(taskService.calls[0]?.input.dueTime, undefined);
  assert.equal(
    (response.structuredContent as {
      data?: { task?: { due_time?: string | null; time_bucket?: string } };
    }).data?.task?.due_time,
    null,
  );
  assert.equal(
    (response.structuredContent as {
      data?: { task?: { time_bucket?: string } };
    }).data?.task?.time_bucket,
    "no_due_date",
  );
});

test("create_task schema excludes identity and lifecycle fields", async (t) => {
  const taskService = new MockTaskToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(taskService),
  );
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const tools = await client.listTools();
  const createTask = tools.tools.find((tool) => tool.name === "create_task");
  const properties = createTask?.inputSchema.properties ?? {};

  for (const forbidden of [
    "user_id",
    "status",
    "completed_at",
    "created_at",
    "updated_at",
  ]) {
    assert.equal(forbidden in properties, false);
  }
  assert.equal(createTask?.annotations?.readOnlyHint, false);
  assert.equal(createTask?.annotations?.idempotentHint, true);
});

test("create_task rejects forbidden fields before calling the service", async (t) => {
  const taskService = new MockTaskToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(taskService),
  );
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "create_task",
    arguments: {
      title: "非法任务",
      description: "测试非法身份和状态字段。",
      due_time: "2026-07-23T16:30:00+08:00",
      timezone: "Asia/Shanghai",
      priority: "normal",
      tags: [],
      author: "L",
      idempotency_key: "task-20260723-forbidden",
      user_id: "00000000-0000-4000-8000-000000000123",
      status: "completed",
      completed_at: "2026-07-22T09:00:00Z",
    },
  });

  assert.equal(response.isError, true);
  assert.equal(taskService.calls.length, 0);
});

test("create_task fails safely without authenticated context", async (t) => {
  const taskService = new MockTaskToolService();
  const { client, server } = await connectTestClient(
    createTestDependencies(taskService, () => {
      throw new CreateTaskAuthenticationError();
    }),
  );
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const response = await client.callTool({
    name: "create_task",
    arguments: {
      title: "未认证任务",
      description: "该请求不应写入。",
      due_time: "2026-07-23T16:30:00+08:00",
      timezone: "Asia/Shanghai",
      priority: "normal",
      tags: [],
      author: "L",
      idempotency_key: "task-20260723-unauthenticated",
    },
  });

  assert.equal(response.isError, true);
  assert.match(
    String(
      response.content[0] && "text" in response.content[0]
        ? response.content[0].text
        : "",
    ),
    /Authentication is required/,
  );
  assert.equal(taskService.calls.length, 0);
});
