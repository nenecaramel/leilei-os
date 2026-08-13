import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ReplaceTodoPaperInput,
  ReplaceTodoPaperResult,
  TodoDayPapers,
  TodoPaper,
  TodoRepository,
} from "../src/domains/todo/todo-types.js";
import { TodoService, TodoServiceError } from "../src/domains/todo/todo-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import {
  registerReadTodoDayTool,
  TodoReadAuthenticationError,
} from "../src/mcp/tools/read-todo-day/register.js";
import { registerListTodoDatesTool } from "../src/mcp/tools/list-todo-dates/register.js";
import {
  registerWriteTodoPaperTool,
  WriteTodoPaperAuthenticationError,
} from "../src/mcp/tools/write-todo-paper/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const DATE = "2026-08-13";
const L_PAPER: TodoPaper = {
  date: DATE,
  author: "L",
  revision: 4,
  entries: [
    { id: "todo-a", kind: "pending", text: "First Todo row" },
    { id: "todo-b", kind: "record", text: "Second Todo row" },
  ],
};
const PAPERS: TodoDayPapers = { L: L_PAPER, G: null };

class TodoToolService {
  readCalls: Array<{ userId: string; date: string }> = [];
  listCalls: string[] = [];
  writeCalls: unknown[] = [];

  async readDay(userId: string, date: string) {
    this.readCalls.push({ userId, date });
    return { date, papers: PAPERS };
  }

  async listDates(userId: string) {
    this.listCalls.push(userId);
    return ["2026-08-11", DATE];
  }

  async replacePaperIdempotently(input: unknown) {
    this.writeCalls.push(input);
    return {
      paper: L_PAPER,
      metadata: { committed: true, idempotent_replay: false },
    };
  }
}

async function connect() {
  const todo = new TodoToolService();
  let authCalls = 0;
  const dependencies = {
    todoTools: {
      todoService: todo,
      getAuthenticatedUserId: () => {
        authCalls += 1;
        return USER_ID;
      },
    },
  };
  const server = createMcpServer(dependencies);
  const client = new Client(
    { name: "todo-mcp-tools-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, todo, authCalls: () => authCalls };
}

async function connectReadImplementations(input?: {
  todoService?: {
    readDay(userId: string, date: string): Promise<{ date: string; papers: TodoDayPapers }>;
    listDates(userId: string): Promise<string[]>;
  };
  getAuthenticatedUserId?: () => string;
}) {
  const todo = input?.todoService ?? new TodoToolService();
  const getAuthenticatedUserId = input?.getAuthenticatedUserId ?? (() => USER_ID);
  const server = new McpServer({ name: "todo-read-tool-test", version: "1.0.0" });
  registerReadTodoDayTool(server, { todoService: todo, getAuthenticatedUserId });
  registerListTodoDatesTool(server, { todoService: todo, getAuthenticatedUserId });
  const client = new Client(
    { name: "todo-read-tool-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, todo };
}

async function connectWriteImplementation(input?: {
  todoService?: { replacePaperIdempotently(input: unknown): Promise<unknown> };
  getAuthenticatedUserId?: () => string;
}) {
  const todo = input?.todoService ?? new TodoToolService();
  let authCalls = 0;
  const getAuthenticatedUserId = input?.getAuthenticatedUserId ?? (() => {
    authCalls += 1;
    return USER_ID;
  });
  const server = new McpServer({ name: "todo-write-tool-test", version: "1.0.0" });
  registerWriteTodoPaperTool(server, {
    todoService: todo as never,
    getAuthenticatedUserId,
  });
  const client = new Client(
    { name: "todo-write-tool-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, todo, authCalls: () => authCalls };
}

class CountingTodoRepository implements TodoRepository {
  readCalls = 0;
  readDay(): Promise<TodoDayPapers> {
    this.readCalls += 1;
    return Promise.resolve(PAPERS);
  }
  listContentDates(): Promise<string[]> {
    return Promise.resolve([]);
  }
  replacePaper(_input: ReplaceTodoPaperInput): Promise<ReplaceTodoPaperResult> {
    return Promise.resolve({ outcome: "conflict" });
  }
}

test("Todo read tool implementations delegate once and preserve exact server truth", async (t) => {
  const fixture = await connectReadImplementations();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const read = await fixture.client.callTool({
    name: "read_todo_day",
    arguments: { date: DATE },
  });
  assert.deepEqual(read.structuredContent, {
    success: true,
    data: { date: DATE, papers: PAPERS },
  });
  const dates = await fixture.client.callTool({
    name: "list_todo_dates",
    arguments: {},
  });
  assert.deepEqual(dates.structuredContent, {
    success: true,
    data: { dates: ["2026-08-11", DATE] },
  });
  assert.deepEqual((fixture.todo as TodoToolService).readCalls, [{ userId: USER_ID, date: DATE }]);
  assert.deepEqual((fixture.todo as TodoToolService).listCalls, [USER_ID]);
});

test("Todo read tools reject invalid dates before repository reads and sanitize failures", async (t) => {
  const repository = new CountingTodoRepository();
  const service = new TodoService(repository);
  const invalid = await connectReadImplementations({ todoService: service });
  t.after(async () => {
    await invalid.client.close();
    await invalid.server.close();
  });
  const invalidResponse = await invalid.client.callTool({
    name: "read_todo_day",
    arguments: { date: "2026-02-30" },
  });
  assert.equal(invalidResponse.isError, true);
  assert.equal(repository.readCalls, 0);

  const unavailable = await connectReadImplementations({
    todoService: {
      async readDay() {
        throw new Error("private database and Todo text detail");
      },
      async listDates() {
        throw new Error("private database and Todo text detail");
      },
    },
  });
  t.after(async () => {
    await unavailable.client.close();
    await unavailable.server.close();
  });
  for (const call of [
    { name: "read_todo_day", arguments: { date: DATE } },
    { name: "list_todo_dates", arguments: {} },
  ]) {
    const response = await unavailable.client.callTool(call);
    assert.equal(response.isError, true);
    assert.doesNotMatch(JSON.stringify(response), /private database|Todo text detail/);
  }

  const unauthenticated = await connectReadImplementations({
    getAuthenticatedUserId: () => {
      throw new TodoReadAuthenticationError();
    },
  });
  t.after(async () => {
    await unauthenticated.client.close();
    await unauthenticated.server.close();
  });
  const authResponse = await unauthenticated.client.callTool({
    name: "read_todo_day",
    arguments: { date: DATE },
  });
  assert.equal(authResponse.isError, true);
});

test("write_todo_paper delegates normalized identity-free input and returns exact metadata", async (t) => {
  const fixture = await connectWriteImplementation();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const response = await fixture.client.callTool({
    name: "write_todo_paper",
    arguments: {
      date: DATE,
      author: "L",
      revision: 3,
      entries: L_PAPER.entries,
      idempotency_key: "todo-paper-direct-20260813",
    },
  });
  assert.deepEqual(response.structuredContent, {
    success: true,
    data: {
      paper: L_PAPER,
      metadata: { committed: true, idempotent_replay: false },
    },
  });
  assert.deepEqual((fixture.todo as TodoToolService).writeCalls, [{
    userId: USER_ID,
    date: DATE,
    author: "L",
    revision: 3,
    entries: L_PAPER.entries,
    idempotencyKey: "todo-paper-direct-20260813",
  }]);
  assert.equal(fixture.authCalls(), 1);
});

test("write_todo_paper strict schema rejects omissions and identity before authentication", async (t) => {
  const fixture = await connectWriteImplementation();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  for (const argumentsValue of [
    { date: DATE, revision: null, entries: [], idempotency_key: "todo-paper-missing-author-01" },
    { date: DATE, author: "L", entries: [], idempotency_key: "todo-paper-missing-revision-1" },
    {
      date: DATE,
      author: "L",
      revision: null,
      entries: [],
      idempotency_key: "todo-paper-identity-20260813",
      user_id: "attacker",
    },
    {
      date: DATE,
      author: "L",
      revision: null,
      entries: [{ id: "a", kind: "pending", text: "x", extra: true }],
      idempotency_key: "todo-paper-entry-extra-0001",
    },
  ]) {
    const response = await fixture.client.callTool({
      name: "write_todo_paper",
      arguments: argumentsValue,
    });
    assert.equal(response.isError, true);
  }
  assert.equal(fixture.authCalls(), 0);
  assert.equal((fixture.todo as TodoToolService).writeCalls.length, 0);
});

test("write_todo_paper distinguishes bounded conflicts and sanitizes internal failures", async (t) => {
  const call = {
    name: "write_todo_paper",
    arguments: {
      date: DATE,
      author: "L",
      revision: null,
      entries: L_PAPER.entries,
      idempotency_key: "todo-paper-errors-20260813",
    },
  };
  for (const [error, expected] of [
    [new TodoServiceError("TODO_PAPER_CONFLICT", "private conflict detail"), /changed/i],
    [new TodoServiceError("IDEMPOTENCY_CONFLICT", "private conflict detail"), /idempotency/i],
    [new TodoServiceError("TODO_ENTRY_INVALID", "private entry detail"), /invalid/i],
    [new Error("private SQL and Todo text detail"), /temporarily unavailable/i],
  ] as const) {
    const fixture = await connectWriteImplementation({
      todoService: {
        async replacePaperIdempotently() {
          throw error;
        },
      },
    });
    const response = await fixture.client.callTool(call);
    await fixture.client.close();
    await fixture.server.close();
    assert.equal(response.isError, true);
    assert.match(JSON.stringify(response), expected);
    assert.doesNotMatch(JSON.stringify(response), /private conflict|private entry|private SQL|Todo text/);
  }

  const unauthenticated = await connectWriteImplementation({
    getAuthenticatedUserId: () => {
      throw new WriteTodoPaperAuthenticationError();
    },
  });
  t.after(async () => {
    await unauthenticated.client.close();
    await unauthenticated.server.close();
  });
  const response = await unauthenticated.client.callTool(call);
  assert.equal(response.isError, true);
  assert.match(JSON.stringify(response), /Authentication is required/);
});

test("Todo exposes exactly the frozen three-tool MCP surface", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tools = (await fixture.client.listTools()).tools;
  assert.equal(tools.length, 19, "the frozen MCP surface must contain exactly 19 tools");
  const todoTools = tools.filter((tool) => tool.name.includes("todo"));
  assert.deepEqual(
    todoTools.map((tool) => tool.name).sort(),
    ["list_todo_dates", "read_todo_day", "write_todo_paper"],
  );
  for (const forbidden of [
    "get_day_space",
    "list_calendar_dates",
    "create_todo_entry",
    "update_todo_entry",
    "delete_todo_entry",
    "archive_todo_paper",
    "restore_todo_paper",
  ]) {
    assert.equal(tools.some((tool) => tool.name === forbidden), false);
  }

  for (const name of ["read_todo_day", "list_todo_dates"]) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  }

  const read = tools.find((tool) => tool.name === "read_todo_day");
  assert.deepEqual(read?.inputSchema.required, ["date"]);
  assert.deepEqual(Object.keys(read?.inputSchema.properties ?? {}), ["date"]);

  const dates = tools.find((tool) => tool.name === "list_todo_dates");
  assert.deepEqual(Object.keys(dates?.inputSchema.properties ?? {}), []);

  const write = tools.find((tool) => tool.name === "write_todo_paper");
  assert.ok(write);
  assert.deepEqual(write.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.deepEqual(
    [...(write.inputSchema.required ?? [])].sort(),
    ["date", "author", "revision", "entries", "idempotency_key"].sort(),
  );
  assert.deepEqual(
    Object.keys(write.inputSchema.properties ?? {}).sort(),
    ["date", "author", "revision", "entries", "idempotency_key"].sort(),
  );
  for (const tool of todoTools) {
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
  }
});

test("Todo read and write tools preserve exact papers and server-owned identity", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const read = await fixture.client.callTool({
    name: "read_todo_day",
    arguments: { date: DATE },
  });
  assert.deepEqual(read.structuredContent, {
    success: true,
    data: { date: DATE, papers: PAPERS },
  });

  const dates = await fixture.client.callTool({
    name: "list_todo_dates",
    arguments: {},
  });
  assert.deepEqual(dates.structuredContent, {
    success: true,
    data: { dates: ["2026-08-11", DATE] },
  });

  const write = await fixture.client.callTool({
    name: "write_todo_paper",
    arguments: {
      date: DATE,
      author: "L",
      revision: 3,
      entries: L_PAPER.entries,
      idempotency_key: "todo-paper-contract-20260813",
    },
  });
  assert.deepEqual(write.structuredContent, {
    success: true,
    data: {
      paper: L_PAPER,
      metadata: { committed: true, idempotent_replay: false },
    },
  });
  assert.deepEqual(fixture.todo.readCalls, [{ userId: USER_ID, date: DATE }]);
  assert.deepEqual(fixture.todo.listCalls, [USER_ID]);
  assert.deepEqual(fixture.todo.writeCalls, [{
    userId: USER_ID,
    date: DATE,
    author: "L",
    revision: 3,
    entries: L_PAPER.entries,
    idempotencyKey: "todo-paper-contract-20260813",
  }]);
  assert.equal(fixture.authCalls(), 3);
});

test("Todo tool schemas reject identity injection before authentication or service", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  for (const attempt of [
    { name: "read_todo_day", arguments: { date: DATE, user_id: "attacker" } },
    { name: "list_todo_dates", arguments: { userId: "attacker" } },
    {
      name: "write_todo_paper",
      arguments: {
        date: DATE,
        author: "L",
        revision: null,
        entries: L_PAPER.entries,
        idempotency_key: "todo-paper-attacker-20260813",
        user_id: "attacker",
      },
    },
  ]) {
    const response = await fixture.client.callTool(attempt);
    assert.equal(response.isError, true);
  }
  assert.equal(fixture.authCalls(), 0);
  assert.equal(fixture.todo.readCalls.length, 0);
  assert.equal(fixture.todo.listCalls.length, 0);
  assert.equal(fixture.todo.writeCalls.length, 0);
});
