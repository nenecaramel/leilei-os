import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CreateDiaryResult } from "../src/domains/diary/diary-service.js";
import type { ToyCommandRecord } from "../src/domains/toy/toy-command-types.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { resolveMcpToolExposure } from "../src/mcp/server/tool-profiles.js";
import { MCP_WRITE_TOOL_NAMES } from "../src/mcp/tools/write-context.js";

const AUTHENTICATED_USER_ID = "00000000-0000-4000-8000-000000000099";

const TODO_PAPER = {
  date: "2026-08-13",
  author: "L" as const,
  revision: 1,
  entries: [{ id: "todo-contract-row", kind: "pending" as const, text: "Todo contract" }],
};

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
  const authCalls = { diary: 0, toy: 0, todo: 0 };
  const diaryCalls: unknown[] = [];
  const toyCalls: unknown[] = [];
  const todoCalls: unknown[] = [];

  const server = createMcpServer({
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
          return { date: TODO_PAPER.date, papers: { L: TODO_PAPER, G: null, C: null } };
        },
        async listDates() {
          return [TODO_PAPER.date];
        },
        async replacePaperIdempotently(input: unknown) {
          todoCalls.push({ operation: "paper", input });
          if (failure) throw failure;
          return {
            paper: { ...TODO_PAPER, entries: TODO_PAPER.entries.map((entry) => ({ ...entry, revision: 1 })) },
            metadata: { committed: true, idempotent_replay: false },
          };
        },
        async appendEntryIdempotently(input: unknown) {
          todoCalls.push({ operation: "append", input });
          if (failure) throw failure;
          return {
            entry: { id: "todo-entry-appended", kind: "pending" as const, text: "Appended", revision: 1 },
            paperRevision: 2,
            metadata: { committed: true, idempotent_replay: false },
          };
        },
        async appendEntriesIdempotently(input: unknown) {
          todoCalls.push({ operation: "append_many", input });
          if (failure) throw failure;
          return {
            entries: [{ id: "todo-entry-batch", kind: "pending" as const, text: "Batch", revision: 1, outcome: "applied" as const }],
            paperRevision: 2,
            metadata: { committed: true, idempotent_replay: false },
          };
        },
        async updateEntryIdempotently(input: unknown) {
          todoCalls.push({ operation: "update", input });
          if (failure) throw failure;
          return {
            entry: { id: "todo-contract-row", kind: "completed" as const, text: "Todo contract", revision: 2 },
            paperRevision: 3,
            metadata: { committed: true, idempotent_replay: false },
          };
        },
        async deleteEntryIdempotently(input: unknown) {
          todoCalls.push({ operation: "delete", input });
          if (failure) throw failure;
          return {
            entryId: "todo-contract-row",
            paperRevision: 4,
            metadata: { committed: true, idempotent_replay: false },
          };
        },
        async search() {
          return { results: [], metadata: { count: 0 } };
        },
      },
    },
  }, undefined, resolveMcpToolExposure(["core"]));

  return { server, authCalls, diaryCalls, toyCalls, todoCalls };
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

async function invokeFixtureWrites(client: Client) {
  return Promise.all([
    client.callTool({
      name: "create_diary",
      arguments: {
        title: "Diary title",
        content: "Diary content",
        date: "2026-08-01",
        tags: [],
        author: "G",
        idempotency_key: "diary-20260801-contract",
      },
    }),
    client.callTool({ name: "toy_set", arguments: { percent: 20, idempotency_key: "toy-set-contract-20260801" } }),
    client.callTool({ name: "toy_stop", arguments: { idempotency_key: "toy-stop-contract-20260801" } }),
    client.callTool({
      name: "replace_todo_paper",
      arguments: {
        date: TODO_PAPER.date,
        author: TODO_PAPER.author,
        expected_revision: null,
        entries: TODO_PAPER.entries,
        idempotency_key: "todo-paper-contract-20260813",
      },
    }),
    client.callTool({
      name: "append_todo_entry",
      arguments: {
        date: TODO_PAPER.date,
        author: TODO_PAPER.author,
        kind: "pending",
        text: "Appended",
        idempotency_key: "todo-entry-append-contract-01",
      },
    }),
    client.callTool({
      name: "append_todo_entries",
      arguments: {
        date: TODO_PAPER.date,
        author: TODO_PAPER.author,
        entries: [{ kind: "pending", text: "Batch" }],
        idempotency_key: "todo-entry-batch-contract-01",
      },
    }),
    client.callTool({
      name: "update_todo_entry",
      arguments: {
        date: TODO_PAPER.date,
        author: TODO_PAPER.author,
        entry_id: "todo-contract-row",
        expected_revision: 1,
        kind: "completed",
        idempotency_key: "todo-entry-update-contract-01",
      },
    }),
    client.callTool({
      name: "delete_todo_entry",
      arguments: {
        date: TODO_PAPER.date,
        author: TODO_PAPER.author,
        entry_id: "todo-contract-row",
        expected_revision: 2,
        idempotency_key: "todo-entry-delete-contract-01",
      },
    }),
  ]);
}

test("MCP exposes only the surviving core write surface", async (t) => {
  const { client, server } = await connect();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  assert.deepEqual(MCP_WRITE_TOOL_NAMES, [
    "write_memory",
    "update_memory",
    "write_diary",
    "toy_set",
    "toy_stop",
    "write_todo_paper",
    "append_todo_entry",
    "append_todo_entries",
    "update_todo_entry",
    "delete_todo_entry",
    "update_diary",
    "add_diary_comment",
    "update_diary_comment",
    "delete_diary_comment",
    "create_universe_node",
    "update_universe_node",
    "create_universe_relation",
    "update_universe_relation",
    "delete_universe_relation",
    "add_universe_diary_source",
    "delete_universe_diary_source",
  ]);

  const tools = (await client.listTools()).tools;
  const writes = tools
    .filter((tool) => tool.annotations?.readOnlyHint === false)
    .map((tool) => tool.name)
    .sort();
  assert.deepEqual(writes, [
    "add_diary_comment",
    "add_universe_diary_source",
    "append_todo_entries",
    "append_todo_entry",
    "create_diary",
    "create_universe_node",
    "create_universe_relation",
    "delete_diary_comment",
    "delete_todo_entry",
    "delete_universe_diary_source",
    "delete_universe_relation",
    "replace_todo_paper",
    "toy_set",
    "toy_stop",
    "update_diary",
    "update_diary_comment",
    "update_memory",
    "update_todo_entry",
    "update_universe_node",
    "update_universe_relation",
    "write_memory",
  ]);

  for (const tool of tools) {
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
  }
});

test("surviving fixture writes resolve server identity once and invoke their service once", async (t) => {
  const { client, server, authCalls, diaryCalls, toyCalls, todoCalls } = await connect();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const responses = await invokeFixtureWrites(client);
  assert.equal(responses.every((response) => response.isError !== true), true);
  assert.deepEqual(authCalls, { diary: 1, toy: 2, todo: 5 });
  assert.equal(diaryCalls.length, 1);
  assert.equal(toyCalls.length, 2);
  assert.equal(todoCalls.length, 5);
  assert.deepEqual((diaryCalls[0] as { context: unknown }).context, { userId: AUTHENTICATED_USER_ID });
  assert.deepEqual(toyCalls.map((call) => (call as { userId: string }).userId), [
    AUTHENTICATED_USER_ID,
    AUTHENTICATED_USER_ID,
  ]);
});

test("unexpected identity arguments are rejected before authentication or writes", async (t) => {
  const { client, server, authCalls, diaryCalls, toyCalls, todoCalls } = await connect();
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const attempts = [
    {
      name: "create_diary",
      arguments: {
        title: "Diary title",
        content: "Diary content",
        date: "2026-08-01",
        tags: [],
        author: "G",
        idempotency_key: "diary-attacker-20260801",
        user_id: "attacker",
      },
    },
    { name: "toy_set", arguments: { percent: 20, idempotency_key: "toy-set-attacker-20260801", user_id: "attacker" } },
    { name: "toy_stop", arguments: { idempotency_key: "toy-stop-attacker-20260801", user_id: "attacker" } },
    {
      name: "replace_todo_paper",
      arguments: {
        date: TODO_PAPER.date,
        author: TODO_PAPER.author,
        expected_revision: null,
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

  assert.deepEqual(authCalls, { diary: 0, toy: 0, todo: 0 });
  assert.equal(diaryCalls.length, 0);
  assert.equal(toyCalls.length, 0);
  assert.equal(todoCalls.length, 0);
});

test("write failures are safe and never retried automatically", async (t) => {
  const internalFailure = new Error("private SQL and device transport detail");
  const { client, server, authCalls, diaryCalls, toyCalls, todoCalls } = await connect(internalFailure);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const responses = await invokeFixtureWrites(client);
  for (const response of responses) {
    assert.equal(response.isError, true);
    assert.doesNotMatch(JSON.stringify(response), /private SQL|device transport detail/);
  }
  assert.deepEqual(authCalls, { diary: 1, toy: 2, todo: 5 });
  assert.equal(diaryCalls.length, 1);
  assert.equal(toyCalls.length, 2);
  assert.equal(todoCalls.length, 5);
});
