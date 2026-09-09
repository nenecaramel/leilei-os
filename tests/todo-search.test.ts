import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TodoService } from "../src/domains/todo/todo-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { createTodoApiRouter } from "../src/web-api/todo-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";

const rows = [
  { id: "00000000-0000-4000-8000-000000000201", entryId: "c-1", date: "2026-08-13", author: "C" as const, kind: "pending" as const, text: "Café 计划\n第二行" },
  { id: "00000000-0000-4000-8000-000000000202", entryId: "l-1", date: "2026-08-12", author: "L" as const, kind: "completed" as const, text: "Old plan" },
];

class SearchRepository {
  findUserById() { return Promise.resolve({ status: "active" as const }); }
  readDay() { return Promise.resolve({ L: null, G: null, C: null }); }
  listContentDates() { return Promise.resolve([]); }
  replacePaper() { return Promise.resolve({ outcome: "conflict" as const }); }
  searchEntries(input: unknown) {
    assert.deepEqual(input, {
      userId: USER_ID,
      query: "café 计划",
      author: "C",
      kind: "pending",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      limit: 10,
    });
    return Promise.resolve([rows[0]!]);
  }
}

test("TodoService search uses one canonical entry contract and filters", async () => {
  const service = new TodoService(new SearchRepository() as never);
  const result = await (service as unknown as { search(input: unknown): Promise<unknown> }).search({
    userId: USER_ID,
    query: " cafe\u0301   计划 ",
    author: "C",
    kind: "pending",
    date_from: "2026-08-01",
    date_to: "2026-08-31",
    limit: 10,
  });
  assert.deepEqual(result, {
    entries: [{ entry_id: rows[0]!.entryId, date: rows[0]!.date, author: rows[0]!.author, kind: rows[0]!.kind, text: rows[0]!.text, snippet: "Café 计划\n第二行" }],
    metadata: { count: 1, author: "C" },
  });
});

test("Todo MCP exposes search_todo with compact entry pointers", async (t) => {
  const server = createMcpServer({
    todoTools: {
      todoService: {
        async readDay() { return { date: "2026-08-13", papers: { L: null, G: null, C: null } }; },
        async listDates() { return []; },
        async replacePaperIdempotently() { throw new Error("unused"); },
        async search() {
          return { entries: [{ entry_id: rows[0]!.entryId, date: rows[0]!.date, author: rows[0]!.author, kind: rows[0]!.kind, text: rows[0]!.text, snippet: "Café 计划" }], metadata: { count: 1, author: "C" } };
        },
      },
      getAuthenticatedUserId: () => USER_ID,
    },
  });
  const client = new Client({ name: "todo-search-test", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const listed = await client.listTools();
  const tool = listed.tools.find((entry) => entry.name === "search_todo");
  assert.ok(tool);
  assert.equal(tool.inputSchema.type, "object");
  assert.ok(tool.inputSchema.properties && "query" in tool.inputSchema.properties);
  const outputSchema = tool.outputSchema as { properties?: { data?: { properties?: { metadata?: { properties?: Record<string, unknown> } } } } };
  assert.ok(outputSchema.properties?.data?.properties?.metadata?.properties?.author);
  const response = await client.callTool({ name: "search_todo", arguments: { query: "计划" } });
  assert.deepEqual(response.structuredContent, { success: true, data: { entries: [{ entry_id: rows[0]!.entryId, date: rows[0]!.date, author: rows[0]!.author, kind: rows[0]!.kind, text: rows[0]!.text, snippet: "Café 计划", detail_tool: "read_todo_day", detail_arguments: { date: rows[0]!.date } }], metadata: { count: 1, author: "C" } } });
  const rejected = await client.callTool({ name: "search_todo", arguments: { query: "😀".repeat(201) } });
  assert.equal(rejected.isError, true);
});

test("Todo API exposes authenticated cross-date search", async () => {
  const router = createTodoApiRouter({ todoService: {} as never });
  const routes = (router as unknown as { stack: Array<{ route?: { path?: string } }> }).stack
    .flatMap((layer) => layer.route?.path ? [layer.route.path] : []);
  assert.ok(routes.includes("/search"), `expected /search route, got ${routes.join(",")}`);
});

test("TodoService rejects invalid search filters and enforces active-user isolation", async () => {
  const calls: unknown[] = [];
  const repository = new SearchRepository();
  repository.searchEntries = (input: unknown) => { calls.push(input); return Promise.resolve([]); };
  const service = new TodoService(repository as never);
  await assert.rejects(() => service.search({ userId: USER_ID, query: "   " }), (error: unknown) => error instanceof Error && "code" in error && error.code === "TODO_SEARCH_INVALID");
  await assert.rejects(() => service.search({ userId: USER_ID, query: "x", author: "X" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "TODO_SEARCH_INVALID");
  await assert.rejects(() => service.search({ userId: USER_ID, query: "x", kind: "other" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "TODO_SEARCH_INVALID");
  await assert.rejects(() => service.search({ userId: USER_ID, query: "x", date_from: "2026-09-02", date_to: "2026-09-01" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "TODO_SEARCH_INVALID");
  await assert.rejects(() => service.search({ userId: USER_ID, query: "x", limit: 51 }), (error: unknown) => error instanceof Error && "code" in error && error.code === "TODO_SEARCH_INVALID");
  assert.equal(calls.length, 0);
});

test("TodoService fails closed for disabled and unknown users before searching", async () => {
  const repository = new SearchRepository();
  repository.findUserById = () => Promise.resolve(null);
  const service = new TodoService(repository as never);
  await assert.rejects(() => service.search({ userId: "wrong-user", query: "x" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "USER_NOT_FOUND");
  repository.findUserById = () => Promise.resolve({ status: "disabled" as const });
  await assert.rejects(() => service.search({ userId: USER_ID, query: "x" }), (error: unknown) => error instanceof Error && "code" in error && error.code === "USER_DISABLED");
});

test("TodoService identifies an author-scoped empty result", async () => {
  const repository = new SearchRepository();
  repository.searchEntries = () => Promise.resolve([]);
  const service = new TodoService(repository as never);
  assert.deepEqual(await service.search({ userId: USER_ID, query: "missing", author: "C" }), {
    entries: [],
    metadata: { count: 0, author: "C" },
  });
});

test("TodoService preserves a bounded result limit and case-insensitive query contract", async () => {
  const repository = new SearchRepository();
  let received: unknown;
  repository.searchEntries = (input: unknown) => { received = input; return Promise.resolve([]); };
  const service = new TodoService(repository as never);
  await service.search({ userId: USER_ID, query: " Café ", limit: 50 });
  assert.deepEqual(received, { userId: USER_ID, query: "café", limit: 50, author: undefined, kind: undefined, dateFrom: undefined, dateTo: undefined });
});
