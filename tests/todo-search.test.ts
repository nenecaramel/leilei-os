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
      query: "café plan",
      author: "C",
      kind: "pending",
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      limit: 10,
    });
    return Promise.resolve(rows);
  }
}

test("TodoService search uses one canonical entry contract and filters", async () => {
  const service = new TodoService(new SearchRepository() as never);
  const result = await (service as unknown as { search(input: unknown): Promise<unknown> }).search({
    userId: USER_ID,
    query: " cafe\u0301   plan ",
    author: "C",
    kind: "pending",
    date_from: "2026-08-01",
    date_to: "2026-08-31",
    limit: 10,
  });
  assert.deepEqual(result, {
    entries: [{ ...rows[0], snippet: "Café 计划\n第二行" }],
    metadata: { count: 1 },
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
          return { entries: [{ ...rows[0], snippet: "Café 计划" }], metadata: { count: 1 } };
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
  const response = await client.callTool({ name: "search_todo", arguments: { query: "计划" } });
  assert.deepEqual(response.structuredContent, { success: true, data: { entries: [{ ...rows[0], snippet: "Café 计划" }], metadata: { count: 1 } } });
});

test("Todo API exposes authenticated cross-date search", async () => {
  const router = createTodoApiRouter({ todoService: {} as never });
  const routes = (router as unknown as { stack: Array<{ route?: { path?: string } }> }).stack
    .flatMap((layer) => layer.route?.path ? [layer.route.path] : []);
  assert.ok(routes.includes("/search"), `expected /search route, got ${routes.join(",")}`);
});
