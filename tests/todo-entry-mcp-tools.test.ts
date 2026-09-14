import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TodoServiceError } from "../src/domains/todo/todo-service.js";
import {
  registerTodoEntryWriteTools,
  TodoEntryWriteAuthenticationError,
} from "../src/mcp/tools/todo-entry/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const DATE = "2026-09-14";

async function connect(input?: {
  todoService?: {
    appendEntryIdempotently(input: unknown): Promise<unknown>;
    updateEntryIdempotently(input: unknown): Promise<unknown>;
    deleteEntryIdempotently(input: unknown): Promise<unknown>;
  };
  getAuthenticatedUserId?: () => string;
}) {
  const calls: Array<{ operation: string; input: unknown }> = [];
  const service = input?.todoService ?? {
    async appendEntryIdempotently(value: unknown) {
      calls.push({ operation: "append", input: value });
      return {
        entry: { id: "11111111-1111-4111-8111-111111111111", kind: "pending", text: "new row", revision: 1 },
        paperRevision: 8,
        metadata: { committed: true, idempotent_replay: false },
      };
    },
    async updateEntryIdempotently(value: unknown) {
      calls.push({ operation: "update", input: value });
      return {
        entry: { id: "todo-a", kind: "completed", text: "changed", revision: 4 },
        paperRevision: 9,
        metadata: { committed: true, idempotent_replay: false },
      };
    },
    async deleteEntryIdempotently(value: unknown) {
      calls.push({ operation: "delete", input: value });
      return {
        entryId: "todo-b",
        paperRevision: 10,
        metadata: { committed: true, idempotent_replay: false },
      };
    },
  };
  const server = new McpServer({ name: "todo-entry-write-test", version: "1.0.0" });
  registerTodoEntryWriteTools(server, {
    todoService: service as never,
    getAuthenticatedUserId: input?.getAuthenticatedUserId ?? (() => USER_ID),
  });
  const client = new Client({ name: "todo-entry-write-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls };
}

test("Todo entry tools delegate server-owned identity and return entry revisions", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });

  const append = await fixture.client.callTool({
    name: "append_todo_entry",
    arguments: {
      date: DATE,
      author: "L",
      kind: "pending",
      text: "new row",
      idempotency_key: "todo-entry-append-20260914",
    },
  });
  assert.deepEqual(append.structuredContent, {
    success: true,
    data: {
      entry: { id: "11111111-1111-4111-8111-111111111111", kind: "pending", text: "new row", revision: 1 },
      paper_revision: 8,
      metadata: { committed: true, idempotent_replay: false },
      detail_tool: "read_todo_day",
      detail_arguments: { date: DATE, author: "L" },
    },
  });

  const update = await fixture.client.callTool({
    name: "update_todo_entry",
    arguments: {
      date: DATE,
      author: "L",
      entry_id: "todo-a",
      expected_revision: 3,
      kind: "completed",
      text: "changed",
      idempotency_key: "todo-entry-update-20260914",
    },
  });
  assert.deepEqual((update.structuredContent as { data: unknown }).data, {
    entry: { id: "todo-a", kind: "completed", text: "changed", revision: 4 },
    paper_revision: 9,
    metadata: { committed: true, idempotent_replay: false },
    detail_tool: "read_todo_day",
    detail_arguments: { date: DATE, author: "L" },
  });

  const remove = await fixture.client.callTool({
    name: "delete_todo_entry",
    arguments: {
      date: DATE,
      author: "L",
      entry_id: "todo-b",
      expected_revision: 2,
      idempotency_key: "todo-entry-delete-20260914",
    },
  });
  assert.deepEqual((remove.structuredContent as { data: unknown }).data, {
    entry_id: "todo-b",
    deleted: true,
    paper_revision: 10,
    metadata: { committed: true, idempotent_replay: false },
    detail_tool: "read_todo_day",
    detail_arguments: { date: DATE, author: "L" },
  });

  assert.deepEqual(fixture.calls, [
    {
      operation: "append",
      input: {
        userId: USER_ID,
        date: DATE,
        author: "L",
        kind: "pending",
        text: "new row",
        idempotencyKey: "todo-entry-append-20260914",
      },
    },
    {
      operation: "update",
      input: {
        userId: USER_ID,
        date: DATE,
        author: "L",
        entryId: "todo-a",
        expectedRevision: 3,
        kind: "completed",
        text: "changed",
        idempotencyKey: "todo-entry-update-20260914",
      },
    },
    {
      operation: "delete",
      input: {
        userId: USER_ID,
        date: DATE,
        author: "L",
        entryId: "todo-b",
        expectedRevision: 2,
        idempotencyKey: "todo-entry-delete-20260914",
      },
    },
  ]);
});

test("Todo entry schemas reject identity injection and incomplete updates before service mutation", async (t) => {
  const fixture = await connect();
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });
  const cases = [
    {
      name: "append_todo_entry",
      arguments: {
        date: DATE,
        author: "L",
        kind: "pending",
        text: "x",
        idempotency_key: "todo-entry-schema-append-1",
        user_id: "attacker",
      },
    },
    {
      name: "update_todo_entry",
      arguments: {
        date: DATE,
        author: "L",
        entry_id: "todo-a",
        expected_revision: 1,
        idempotency_key: "todo-entry-schema-update-1",
      },
    },
    {
      name: "delete_todo_entry",
      arguments: {
        date: DATE,
        author: "L",
        entry_id: "todo-a",
        expected_revision: 0,
        idempotency_key: "todo-entry-schema-delete-1",
      },
    },
  ];
  for (const call of cases) {
    const response = await fixture.client.callTool(call);
    assert.equal(response.isError, true);
  }
  assert.equal(fixture.calls.length, 0);
});

test("Todo entry tools preserve bounded conflicts and sanitize internal failures", async (t) => {
  for (const [error, code] of [
    [new TodoServiceError("TODO_ENTRY_CONFLICT", "private stale detail"), "TODO_ENTRY_CONFLICT"],
    [new TodoServiceError("TODO_ENTRY_NOT_FOUND", "private missing detail"), "TODO_ENTRY_NOT_FOUND"],
    [new TodoServiceError("IDEMPOTENCY_CONFLICT", "private idem detail"), "IDEMPOTENCY_CONFLICT"],
    [new Error("private SQL todo text"), "INTERNAL_ERROR"],
  ] as const) {
    const fixture = await connect({
      todoService: {
        async appendEntryIdempotently() { throw error; },
        async updateEntryIdempotently() { throw error; },
        async deleteEntryIdempotently() { throw error; },
      },
    });
    t.after(async () => {
      await fixture.client.close();
      await fixture.server.close();
    });
    const response = await fixture.client.callTool({
      name: "update_todo_entry",
      arguments: {
        date: DATE,
        author: "L",
        entry_id: "todo-a",
        expected_revision: 1,
        text: "x",
        idempotency_key: "todo-entry-error-case-0001",
      },
    });
    assert.equal(response.isError, true);
    assert.match(JSON.stringify(response), new RegExp(code));
    assert.doesNotMatch(JSON.stringify(response), /private stale|private missing|private idem|private SQL|todo text/i);
  }
});

test("Todo entry write auth maps to authentication required", async (t) => {
  const fixture = await connect({
    getAuthenticatedUserId: () => {
      throw new TodoEntryWriteAuthenticationError();
    },
  });
  t.after(async () => {
    await fixture.client.close();
    await fixture.server.close();
  });
  const response = await fixture.client.callTool({
    name: "append_todo_entry",
    arguments: {
      date: DATE,
      author: "L",
      kind: "pending",
      text: "x",
      idempotency_key: "todo-entry-auth-case-0001",
    },
  });
  assert.equal(response.isError, true);
  assert.match(JSON.stringify(response), /AUTHENTICATION_REQUIRED/);
});
