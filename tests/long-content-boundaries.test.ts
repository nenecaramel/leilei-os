import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  DIARY_CONTENT_MAX_LENGTH,
  MEMORY_CONTENT_MAX_LENGTH,
} from "../src/domains/resource-limits.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const MEMORY_ID = "00000000-0000-4000-8000-000000000101";
const DIARY_ID = "00000000-0000-4000-8000-000000000102";
const LONG_CONTENT = "蕾".repeat(100_000);
const OVER_LIMIT_CONTENT = "蕾".repeat(100_001);

const memory = {
  id: MEMORY_ID,
  category: "goal" as const,
  key: "long-memory",
  content: LONG_CONTENT,
  tags: [],
  source: "mcp",
  lifecycle_status: "active" as const,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
  author: "L" as const,
};

const diary = {
  id: DIARY_ID,
  title: "Long diary",
  content: LONG_CONTENT,
  date: "2026-08-25",
  tags: [],
  mood: null,
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
  author: "G" as const,
};

async function connect() {
  const calls = { writeMemory: 0, updateMemory: 0, writeDiary: 0, updateDiary: 0 };
  const server = createMcpServer({
    writeMemory: {
      getAuthenticatedUserId: () => USER_ID,
      memoryService: {
        async createMcpMemory() {
          calls.writeMemory += 1;
          return { memory, metadata: { created: true, idempotent_replay: false } };
        },
      },
    },
    updateMemory: {
      getAuthenticatedUserId: () => USER_ID,
      memoryService: {
        async updateMcpMemory() {
          calls.updateMemory += 1;
          return memory;
        },
      },
    },
    writeDiary: {
      getAuthenticatedUserId: () => USER_ID,
      diaryService: {
        async createMcpDiary() {
          calls.writeDiary += 1;
          return { diary, metadata: { created: true, idempotent_replay: false } };
        },
      },
    },
    updateDiary: {
      getAuthenticatedUserId: () => USER_ID,
      diaryService: {
        async updateMcpDiary() {
          calls.updateDiary += 1;
          return diary;
        },
      },
    },
  });
  const client = new Client({ name: "long-content-boundaries", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server, calls };
}

test("Memory and Diary canonical content limits are exactly 100,000 units", () => {
  assert.equal(MEMORY_CONTENT_MAX_LENGTH, 100_000);
  assert.equal(DIARY_CONTENT_MAX_LENGTH, 100_000);
  assert.equal(LONG_CONTENT.length, 100_000);
  assert.equal("😀".repeat(50_000).length, 100_000);
});

test("Memory and Diary MCP write/update adapters accept the canonical 100k boundary", async (t) => {
  const { client, server, calls } = await connect();
  t.after(async () => { await client.close(); await server.close(); });

  const responses = await Promise.all([
    client.callTool({ name: "write_memory", arguments: { category: "goal", key: "long", content: LONG_CONTENT, author: "L", idempotency_key: "long-memory-0001" } }),
    client.callTool({ name: "update_memory", arguments: { id: MEMORY_ID, content: LONG_CONTENT } }),
    client.callTool({ name: "write_diary", arguments: { title: "Long diary", content: LONG_CONTENT, date: "2026-08-25", tags: [], author: "G", idempotency_key: "long-diary-00001" } }),
    client.callTool({ name: "update_diary", arguments: { id: DIARY_ID, content: LONG_CONTENT } }),
  ]);

  assert.deepEqual(responses.map((response) => response.isError), [undefined, undefined, undefined, undefined], JSON.stringify(responses.map((response) => response.content)));
  assert.deepEqual(calls, { writeMemory: 1, updateMemory: 1, writeDiary: 1, updateDiary: 1 });
});

test("Memory and Diary MCP write/update adapters reject content above the canonical boundary", async (t) => {
  const { client, server, calls } = await connect();
  t.after(async () => { await client.close(); await server.close(); });

  const responses = await Promise.all([
    client.callTool({ name: "write_memory", arguments: { category: "goal", key: "long", content: OVER_LIMIT_CONTENT, author: "L", idempotency_key: "long-memory-0002" } }),
    client.callTool({ name: "update_memory", arguments: { id: MEMORY_ID, content: OVER_LIMIT_CONTENT } }),
    client.callTool({ name: "write_diary", arguments: { title: "Long diary", content: OVER_LIMIT_CONTENT, date: "2026-08-25", tags: [], author: "G", idempotency_key: "long-diary-00002" } }),
    client.callTool({ name: "update_diary", arguments: { id: DIARY_ID, content: OVER_LIMIT_CONTENT } }),
  ]);

  assert.deepEqual(responses.map((response) => response.isError), [true, true, true, true]);
  assert.deepEqual(calls, { writeMemory: 0, updateMemory: 0, writeDiary: 0, updateDiary: 0 });
});
