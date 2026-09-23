import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  decodeMcpPaginationCursor,
  McpPaginationCursorError,
  paginateMcpRows,
} from "../src/mcp/tools/pagination.js";
import { registerListTodoDatesTool } from "../src/mcp/tools/list-todo-dates/register.js";

test("opaque MCP cursors round-trip offsets and reject mismatched request context", () => {
  const first = paginateMcpRows({
    rows: ["a", "b", "c"],
    pageSize: 2,
    offset: 0,
    tool: "search_memory",
    context: { query: "memory", category: "project" },
  });
  assert.deepEqual(first.items, ["a", "b"]);
  assert.equal(first.metadata.returned, 2);
  assert.equal(first.metadata.has_more, true);
  assert.ok(first.metadata.next_cursor);

  const offset = decodeMcpPaginationCursor(
    first.metadata.next_cursor ?? undefined,
    "search_memory",
    { query: "memory", category: "project" },
  );
  assert.equal(offset, 2);

  assert.throws(
    () => decodeMcpPaginationCursor(
      first.metadata.next_cursor ?? undefined,
      "search_memory",
      { query: "different", category: "project" },
    ),
    McpPaginationCursorError,
  );
  assert.throws(
    () => decodeMcpPaginationCursor(
      first.metadata.next_cursor ?? undefined,
      "search_diary",
      { query: "memory", category: "project" },
    ),
    McpPaginationCursorError,
  );
});

test("list_todo_dates continues without overlap using the returned cursor", async (t) => {
  const server = new McpServer({ name: "pagination-test", version: "1.0.0" });
  registerListTodoDatesTool(server, {
    todoService: {
      async listDates(_userId, limit, offset = 0) {
        const dates = [
          "2026-09-19",
          "2026-09-20",
          "2026-09-21",
          "2026-09-22",
          "2026-09-23",
        ];
        return limit === undefined ? dates : dates.slice(offset, offset + limit);
      },
    },
    getAuthenticatedUserId: () => "00000000-0000-4000-8000-000000000099",
  });

  const client = new Client(
    { name: "pagination-client", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const first = await client.callTool({
    name: "list_todo_dates",
    arguments: { limit: 2 },
  });
  const firstData = (first.structuredContent as {
    data: {
      dates: string[];
      metadata: {
        returned: number;
        has_more: boolean;
        next_cursor: string | null;
      };
    };
  }).data;
  assert.deepEqual(firstData.dates, ["2026-09-19", "2026-09-20"]);
  assert.deepEqual(
    {
      returned: firstData.metadata.returned,
      has_more: firstData.metadata.has_more,
    },
    { returned: 2, has_more: true },
  );
  assert.ok(firstData.metadata.next_cursor);

  const second = await client.callTool({
    name: "list_todo_dates",
    arguments: {
      limit: 2,
      cursor: firstData.metadata.next_cursor,
    },
  });
  const secondData = (second.structuredContent as {
    data: {
      dates: string[];
      metadata: {
        returned: number;
        has_more: boolean;
        next_cursor: string | null;
      };
    };
  }).data;
  assert.deepEqual(secondData.dates, ["2026-09-21", "2026-09-22"]);
  assert.equal(secondData.metadata.returned, 2);
  assert.equal(secondData.metadata.has_more, true);

  const mismatch = await client.callTool({
    name: "list_todo_dates",
    arguments: { cursor: "not-a-valid-cursor" },
  });
  assert.equal(mismatch.isError, true);
  assert.match(JSON.stringify(mismatch.structuredContent), /INVALID_CURSOR/);
});
