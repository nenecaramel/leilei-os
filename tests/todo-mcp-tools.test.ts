import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { TodoDayPapers, TodoPaper } from "../src/domains/todo/todo-types.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

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

test("Todo exposes exactly the frozen three-tool MCP surface", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const tools = (await fixture.client.listTools()).tools;
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
