import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  TaskDomainError,
  type AuthenticatedTaskContext,
  type CreateTaskInput,
  type CreateTaskResult,
  type ListTasksInput,
  type ListTasksResult,
  type ReadTaskInput,
  type TaskEntryResult,
} from "../src/domains/task/task-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { TaskReadAuthenticationError } from "../src/mcp/tools/list-tasks/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const TASK: TaskEntryResult = {
  id: "legacy-task-id",
  title: "完成 Task MCP reads",
  description: "这是只有 get_task 才应返回的完整任务正文。",
  status: "in_progress",
  priority: "high",
  due_time: "2026-08-01T08:00:00.000Z",
  timezone: "Asia/Shanghai",
  time_bucket: "next_7_days",
  tags: ["MCP", "Task"],
  created_at: "2026-07-28T08:00:00.000Z",
  updated_at: "2026-07-29T08:00:00.000Z",
  completed_at: null,
  allowed_actions: ["complete", "cancel"],
};

class MockTaskService {
  listCalls: ListTasksInput[] = [];
  readCalls: ReadTaskInput[] = [];
  createCalls: Array<{
    context: AuthenticatedTaskContext;
    input: CreateTaskInput;
  }> = [];
  listError?: unknown;
  readError?: unknown;

  async listTasks(input: ListTasksInput): Promise<ListTasksResult> {
    this.listCalls.push(input);
    if (this.listError) throw this.listError;
    return { tasks: [TASK], metadata: { count: 1 } };
  }

  async readTask(input: ReadTaskInput): Promise<TaskEntryResult> {
    this.readCalls.push(input);
    if (this.readError) throw this.readError;
    return TASK;
  }

  async createTask(
    context: AuthenticatedTaskContext,
    input: CreateTaskInput,
  ): Promise<CreateTaskResult> {
    this.createCalls.push({ context, input });
    return {
      task: {
        ...TASK,
        id: "00000000-0000-4000-8000-000000000010",
      },
    };
  }
}

async function connect(
  service: MockTaskService,
  getAuthenticatedUserId: () => string = () => USER_ID,
) {
  const server = createMcpServer({
    taskTools: { taskService: service, getAuthenticatedUserId },
  });
  const client = new Client(
    { name: "task-read-tools-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const first = result.content[0];
  return first && "text" in first ? String(first.text) : "";
}

test("Task reads are registered read-only while create_task remains a write", async (t) => {
  const { client, server } = await connect(new MockTaskService());
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const tools = await client.listTools();
  for (const name of ["list_tasks", "get_task"]) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    assert.ok(tool);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
  }
  assert.equal(
    tools.tools.find((tool) => tool.name === "create_task")?.annotations
      ?.readOnlyHint,
    false,
  );
});

test("list_tasks maps identity, filters, and limit while omitting description", async (t) => {
  const service = new MockTaskService();
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({
    name: "list_tasks",
    arguments: {
      query: "  MCP  ",
      status: "in_progress",
      priority: "high",
      tag: "  Task  ",
      due: "custom",
      due_from: "2026-07-29T00:00:00+08:00",
      due_to: "2026-08-05T00:00:00+08:00",
      limit: 12,
    },
  });
  assert.deepEqual(service.listCalls, [{
    userId: USER_ID,
    limit: 12,
    query: {
      q: "MCP",
      status: "in_progress",
      priority: "high",
      tag: "Task",
      due: "custom",
      dueFrom: "2026-07-29T00:00:00+08:00",
      dueTo: "2026-08-05T00:00:00+08:00",
    },
  }]);
  const serialized = JSON.stringify(result.structuredContent);
  assert.equal(serialized.includes(TASK.description), false);
  assert.equal(serialized.includes('"description"'), false);
  assert.deepEqual(result.structuredContent, {
    success: true,
    data: {
      tasks: [{
        id: TASK.id,
        title: TASK.title,
        status: TASK.status,
        priority: TASK.priority,
        due_time: TASK.due_time,
        timezone: TASK.timezone,
        time_bucket: TASK.time_bucket,
        tags: TASK.tags,
        created_at: TASK.created_at,
        updated_at: TASK.updated_at,
        completed_at: TASK.completed_at,
        allowed_actions: TASK.allowed_actions,
      }],
      metadata: { count: 1 },
    },
  });
});

test("list_tasks defaults to limit 50 and rejects invalid schemas", async () => {
  const service = new MockTaskService();
  const pair = await connect(service);
  await pair.client.callTool({ name: "list_tasks", arguments: {} });
  assert.deepEqual(service.listCalls[0], {
    userId: USER_ID,
    limit: 50,
    query: {
      q: undefined,
      status: undefined,
      priority: undefined,
      tag: undefined,
      due: undefined,
      dueFrom: undefined,
      dueTo: undefined,
    },
  });
  await pair.client.close();
  await pair.server.close();

  for (const arguments_ of [
    { query: "" },
    { status: "archived" },
    { priority: "critical" },
    { tag: "" },
    { due: "later" },
    { due_from: "" },
    { limit: 0 },
    { limit: 51 },
    { user_id: USER_ID },
  ]) {
    const invalidService = new MockTaskService();
    const invalidPair = await connect(invalidService);
    const result = await invalidPair.client.callTool({
      name: "list_tasks",
      arguments: arguments_,
    });
    assert.equal(result.isError, true);
    assert.equal(invalidService.listCalls.length, 0);
    await invalidPair.client.close();
    await invalidPair.server.close();
  }
});

test("list_tasks safely maps domain, user, authentication, and unexpected errors", async () => {
  for (const [error, expected, secret] of [
    [
      new TaskDomainError("INVALID_TASK_QUERY", "private filter"),
      /list request is invalid/,
      "private filter",
    ],
    [
      new TaskDomainError("USER_DISABLED", "private user"),
      /unavailable for the authenticated user/,
      "private user",
    ],
    [
      new TaskDomainError("USER_NOT_FOUND", "missing private user"),
      /unavailable for the authenticated user/,
      "missing private user",
    ],
    [new Error("SQL password"), /temporarily unavailable/, "SQL password"],
  ] as const) {
    const service = new MockTaskService();
    service.listError = error;
    const pair = await connect(service);
    const result = await pair.client.callTool({
      name: "list_tasks",
      arguments: {},
    });
    assert.match(textOf(result), expected);
    assert.equal(textOf(result).includes(secret), false);
    await pair.client.close();
    await pair.server.close();
  }

  const service = new MockTaskService();
  const pair = await connect(service, () => {
    throw new TaskReadAuthenticationError();
  });
  const result = await pair.client.callTool({
    name: "list_tasks",
    arguments: {},
  });
  assert.match(textOf(result), /Authentication is required/);
  assert.equal(service.listCalls.length, 0);
  await pair.client.close();
  await pair.server.close();
});

test("get_task accepts a trimmed non-UUID id and returns complete detail", async (t) => {
  const service = new MockTaskService();
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({
    name: "get_task",
    arguments: { id: `  ${TASK.id}  ` },
  });
  assert.deepEqual(service.readCalls, [{ userId: USER_ID, id: TASK.id }]);
  assert.deepEqual(result.structuredContent, { success: true, data: TASK });
});

test("get_task rejects empty ids and hides inaccessible records", async () => {
  const service = new MockTaskService();
  const pair = await connect(service);
  const invalid = await pair.client.callTool({
    name: "get_task",
    arguments: { id: " " },
  });
  assert.equal(invalid.isError, true);
  assert.equal(service.readCalls.length, 0);
  await pair.client.close();
  await pair.server.close();

  const hidden = new MockTaskService();
  hidden.readError = new TaskDomainError(
    "TASK_NOT_FOUND",
    "cross-user task exists",
  );
  const hiddenPair = await connect(hidden);
  const result = await hiddenPair.client.callTool({
    name: "get_task",
    arguments: { id: "private-task-id" },
  });
  assert.match(textOf(result), /Task was not found/);
  assert.equal(textOf(result).includes("cross-user"), false);
  await hiddenPair.client.close();
  await hiddenPair.server.close();
});

test("get_task safely maps unavailable users, authentication, and unexpected errors", async () => {
  for (const [error, expected, secret] of [
    [
      new TaskDomainError("USER_DISABLED", "private disabled user"),
      /unavailable for the authenticated user/,
      "private disabled user",
    ],
    [
      new TaskDomainError("USER_NOT_FOUND", "private missing user"),
      /unavailable for the authenticated user/,
      "private missing user",
    ],
    [new Error("database host secret"), /temporarily unavailable/, "host secret"],
  ] as const) {
    const service = new MockTaskService();
    service.readError = error;
    const pair = await connect(service);
    const result = await pair.client.callTool({
      name: "get_task",
      arguments: { id: TASK.id },
    });
    assert.match(textOf(result), expected);
    assert.equal(textOf(result).includes(secret), false);
    await pair.client.close();
    await pair.server.close();
  }

  const service = new MockTaskService();
  const pair = await connect(service, () => {
    throw new TaskReadAuthenticationError();
  });
  const result = await pair.client.callTool({
    name: "get_task",
    arguments: { id: TASK.id },
  });
  assert.match(textOf(result), /Authentication is required/);
  assert.equal(service.readCalls.length, 0);
  await pair.client.close();
  await pair.server.close();
});

test("shared Task dependency preserves create_task behavior", async (t) => {
  const service = new MockTaskService();
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({
    name: "create_task",
    arguments: {
      title: "Existing create flow",
      description: "This still uses the shared Task Service.",
      priority: "high",
      tags: ["MCP"],
    },
  });
  assert.equal(result.isError, undefined);
  assert.equal(service.createCalls.length, 1);
  assert.equal(service.createCalls[0]?.context.userId, USER_ID);
});
