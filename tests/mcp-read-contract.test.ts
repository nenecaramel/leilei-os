import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
  ReadMemoryDetailResult,
  ReadMemoryInput,
  ReadMemoryResult,
} from "../src/domains/memory/memory-service.js";
import type {
  AuthenticatedDiaryContext,
  CreateDiaryInput,
  DiaryEntryResult,
  ListDiariesInput,
  ListDiariesResult,
  ReadDiaryInput,
} from "../src/domains/diary/diary-service.js";
import type {
  AuthenticatedTaskContext,
  CreateTaskInput,
  ListTasksInput,
  ListTasksResult,
  ReadTaskInput,
  TaskEntryResult,
} from "../src/domains/task/task-service.js";
import type { TodoDayPapers } from "../src/domains/todo/todo-types.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

const MEMORY = {
  id: "memory-contract-id",
  category: "project" as const,
  key: "memory-contract",
  searchContent: "Bounded Memory discovery content.",
  detailContent: "Complete Memory detail content.",
  tags: ["Memory", "MCP"],
  source: "web",
  updated_at: "2026-07-29T08:00:00.000Z",
  author: "L" as const,
};

const DIARY: DiaryEntryResult = {
  id: "diary-contract-id",
  title: "Diary contract",
  content: "Complete Diary detail content.",
  date: "2026-07-29",
  tags: ["Diary", "MCP"],
  mood: "focused",
  created_at: "2026-07-29T07:00:00.000Z",
  updated_at: "2026-07-29T08:10:00.000Z",
  author: "G",
};

const TASK: TaskEntryResult = {
  id: "task-contract-id",
  title: "Task contract",
  description: "Complete Task detail description.",
  status: "in_progress",
  priority: "high",
  due_time: "2026-08-01T08:00:00.000Z",
  timezone: "Asia/Shanghai",
  time_bucket: "next_7_days",
  tags: ["Task", "MCP"],
  created_at: "2026-07-29T07:20:00.000Z",
  updated_at: "2026-07-29T08:20:00.000Z",
  completed_at: null,
  allowed_actions: ["complete", "cancel"],
  author: null,
};

class MemoryReads {
  readCalls: ReadMemoryInput[] = [];
  detailCalls: Array<{ userId: string; id: string }> = [];

  async readMemory(input: ReadMemoryInput): Promise<ReadMemoryResult> {
    this.readCalls.push(input);
    return {
      user: { display_name: "Leilei" },
      memories: [{
        id: MEMORY.id,
        category: MEMORY.category,
        key: MEMORY.key,
        content: MEMORY.searchContent,
        tags: MEMORY.tags,
        author: MEMORY.author,
        updated_at: MEMORY.updated_at,
      }],
      metadata: { count: 1 },
    };
  }

  async readMemoryDetail(input: {
    userId: string;
    id: string;
  }): Promise<ReadMemoryDetailResult> {
    this.detailCalls.push(input);
    return {
      id: MEMORY.id,
      category: MEMORY.category,
      key: MEMORY.key,
      content: MEMORY.detailContent,
      tags: MEMORY.tags,
      source: MEMORY.source,
      updated_at: MEMORY.updated_at,
      lifecycle_status: "active",
      author: MEMORY.author,
    };
  }
}

class DiaryTools {
  listCalls: ListDiariesInput[] = [];
  readCalls: ReadDiaryInput[] = [];
  writeCalls = 0;

  async listDiaries(input: ListDiariesInput): Promise<ListDiariesResult> {
    this.listCalls.push(input);
    return { diaries: [DIARY], metadata: { count: 1 } };
  }

  async readDiary(input: ReadDiaryInput): Promise<DiaryEntryResult> {
    this.readCalls.push(input);
    return DIARY;
  }

  async createMcpDiary(
    _context: AuthenticatedDiaryContext,
    _input: CreateDiaryInput,
  ): Promise<never> {
    this.writeCalls += 1;
    throw new Error("write_diary must not be invoked by this suite");
  }
}

class TaskTools {
  listCalls: ListTasksInput[] = [];
  readCalls: ReadTaskInput[] = [];
  writeCalls = 0;

  async listTasks(input: ListTasksInput): Promise<ListTasksResult> {
    this.listCalls.push(input);
    return { tasks: [TASK], metadata: { count: 1 } };
  }

  async readTask(input: ReadTaskInput): Promise<TaskEntryResult> {
    this.readCalls.push(input);
    return TASK;
  }

  async createTaskIdempotently(
    _context: AuthenticatedTaskContext,
    _input: CreateTaskInput,
    _idempotencyKey: string,
  ): Promise<never> {
    this.writeCalls += 1;
    throw new Error("create_task must not be invoked by this suite");
  }
}

class ToyWrites {
  writeCalls = 0;

  async createIdempotently(): Promise<never> {
    this.writeCalls += 1;
    throw new Error("Toy writes must not be invoked by this suite");
  }
}

class TodoTools {
  readCalls: Array<{ userId: string; date: string }> = [];
  listCalls: string[] = [];

  async readDay(userId: string, date: string): Promise<{
    date: string;
    papers: TodoDayPapers;
  }> {
    this.readCalls.push({ userId, date });
    return { date, papers: { L: null, G: null, C: null } };
  }

  async listDates(userId: string): Promise<string[]> {
    this.listCalls.push(userId);
    return ["2026-08-13"];
  }

  async replacePaperIdempotently(): Promise<never> {
    throw new Error("write_todo_paper must not be invoked by this suite");
  }
}

async function connect() {
  const memory = new MemoryReads();
  const diary = new DiaryTools();
  const task = new TaskTools();
  const toy = new ToyWrites();
  const todo = new TodoTools();
  const getAuthenticatedUserId = () => USER_ID;
  const dependencies = {
    memoryReads: {
      memoryService: memory,
      getAuthenticatedUserId,
    },
    diaryTools: {
      diaryService: diary,
      getAuthenticatedUserId,
    },
    taskTools: {
      taskService: task,
      getAuthenticatedUserId,
    },
    toyCommand: {
      toyCommandService: toy,
      getAuthenticatedUserId,
    },
    todoTools: {
      todoService: todo,
      getAuthenticatedUserId,
    },
  };
  const server = createMcpServer(dependencies);
  const client = new Client(
    { name: "mcp-read-contract-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, memory, diary, task, toy, todo };
}

test("all MCP read contracts and existing write boundaries stay registered", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tools = await fixture.client.listTools();
  for (const name of [
    "read_memory",
    "search_memory",
    "get_memory",
    "search_diary",
    "get_diary",
    "list_tasks",
    "get_task",
    "read_todo_day",
    "list_todo_dates",
    "search_universe",
    "get_universe_node",
    "get_universe_relations",
  ]) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be registered`);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
  }

  for (const name of ["write_diary", "create_task", "toy_set", "toy_stop"]) {
    assert.ok(
      tools.tools.some((tool) => tool.name === name),
      `${name} should remain registered`,
    );
  }
  assert.equal(fixture.diary.writeCalls, 0);
  assert.equal(fixture.task.writeCalls, 0);
  assert.equal(fixture.toy.writeCalls, 0);
  assert.equal(fixture.todo.readCalls.length, 0);
  assert.equal(fixture.todo.listCalls.length, 0);
});

test("Memory, Diary, and Task discovery-to-detail flows remain isolated", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const memorySearch = await fixture.client.callTool({
    name: "search_memory",
    arguments: { query: "contract" },
  });
  const memorySearchData = memorySearch.structuredContent as {
    data: {
      memories: Array<Record<string, unknown>>;
      metadata: { count: number };
    };
  };
  const memoryItem = memorySearchData.data.memories[0]!;
  assert.equal(memorySearchData.data.metadata.count, 1);
  assert.deepEqual(memoryItem, {
    id: MEMORY.id,
    category: MEMORY.category,
    key: MEMORY.key,
    snippet: null,
    tags: MEMORY.tags,
    author: MEMORY.author,
    updated_at: MEMORY.updated_at,
    detail_tool: "get_memory",
    detail_arguments: { id: MEMORY.id, scope: "active" },
  });
  assert.equal("source" in memoryItem, false);

  const memoryDetail = await fixture.client.callTool({
    name: "get_memory",
    arguments: { id: memoryItem.id },
  });
  const memoryDetailJson = JSON.stringify(memoryDetail.structuredContent);
  assert.deepEqual(memoryDetail.structuredContent, {
    success: true,
    data: {
      id: MEMORY.id,
      category: MEMORY.category,
      key: MEMORY.key,
      content: MEMORY.detailContent,
      tags: MEMORY.tags,
      source: MEMORY.source,
      updated_at: MEMORY.updated_at,
      lifecycle_status: "active",
      author: MEMORY.author,
    },
  });

  const legacyMemory = await fixture.client.callTool({
    name: "read_memory",
    arguments: {},
  });
  assert.equal(legacyMemory.isError, undefined);
  assert.equal(
    (legacyMemory.structuredContent as {
      data: { metadata: { count: number } };
    }).data.metadata.count,
    1,
  );

  const diarySearch = await fixture.client.callTool({
    name: "search_diary",
    arguments: {},
  });
  const diarySearchData = diarySearch.structuredContent as {
    data: {
      diaries: Array<Record<string, unknown>>;
      metadata: { count: number };
    };
  };
  const diaryItem = diarySearchData.data.diaries[0]!;
  assert.equal(diarySearchData.data.metadata.count, 1);
  assert.equal("content" in diaryItem, false);
  const diaryDetail = await fixture.client.callTool({
    name: "get_diary",
    arguments: { id: diaryItem.id },
  });
  const diaryDetailJson = JSON.stringify(diaryDetail.structuredContent);
  assert.equal(
    (diaryDetail.structuredContent as { data: DiaryEntryResult }).data.content,
    DIARY.content,
  );

  const taskSearch = await fixture.client.callTool({
    name: "list_tasks",
    arguments: {},
  });
  const taskSearchData = taskSearch.structuredContent as {
    data: {
      tasks: Array<Record<string, unknown>>;
      metadata: { count: number };
    };
  };
  const taskItem = taskSearchData.data.tasks[0]!;
  assert.equal(taskSearchData.data.metadata.count, 1);
  assert.equal("description" in taskItem, false);
  for (const field of [
    "status",
    "priority",
    "due_time",
    "timezone",
    "time_bucket",
    "allowed_actions",
  ]) {
    assert.ok(field in taskItem, `${field} should be discoverable`);
  }
  const taskDetail = await fixture.client.callTool({
    name: "get_task",
    arguments: { id: taskItem.id },
  });
  const taskDetailJson = JSON.stringify(taskDetail.structuredContent);
  assert.equal(
    (taskDetail.structuredContent as { data: TaskEntryResult }).data.description,
    TASK.description,
  );

  for (const [json, forbidden] of [
    [memoryDetailJson, [DIARY.content, TASK.description]],
    [diaryDetailJson, [MEMORY.detailContent, TASK.description]],
    [taskDetailJson, [MEMORY.detailContent, DIARY.content]],
  ] as const) {
    for (const value of forbidden) assert.equal(json.includes(value), false);
  }

  assert.deepEqual(
    fixture.memory.readCalls.map((call) => call.userId),
    [USER_ID, USER_ID],
  );
  assert.equal(fixture.memory.readCalls[0]?.query, "contract");
  assert.deepEqual(fixture.memory.detailCalls, [{
    userId: USER_ID,
    id: MEMORY.id,
  }]);
  assert.deepEqual(fixture.diary.listCalls, [{
    userId: USER_ID,
    limit: undefined,
    query: {
      q: undefined,
      tag: undefined,
      mood: undefined,
      dateFrom: undefined,
      dateTo: undefined,
    },
  }]);
  assert.deepEqual(fixture.diary.readCalls, [{
    userId: USER_ID,
    id: DIARY.id,
  }]);
  assert.deepEqual(fixture.task.listCalls, [{
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
  }]);
  assert.deepEqual(fixture.task.readCalls, [{
    userId: USER_ID,
    id: TASK.id,
  }]);
  assert.equal(fixture.diary.writeCalls, 0);
  assert.equal(fixture.task.writeCalls, 0);
  assert.equal(fixture.toy.writeCalls, 0);
});

test("strict schemas reject client-supplied identity before every module service", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  for (const name of [
    "search_memory",
    "search_diary",
    "list_tasks",
    "read_todo_day",
    "list_todo_dates",
  ]) {
    const result = await fixture.client.callTool({
      name,
      arguments: name === "read_todo_day"
        ? { date: "2026-08-13", user_id: "attacker-controlled-user" }
        : { user_id: "attacker-controlled-user" },
    });
    assert.equal(result.isError, true);
  }
  assert.equal(fixture.memory.readCalls.length, 0);
  assert.equal(fixture.diary.listCalls.length, 0);
  assert.equal(fixture.task.listCalls.length, 0);
  assert.equal(fixture.diary.writeCalls, 0);
  assert.equal(fixture.task.writeCalls, 0);
  assert.equal(fixture.toy.writeCalls, 0);
  assert.equal(fixture.todo.readCalls.length, 0);
  assert.equal(fixture.todo.listCalls.length, 0);
});
