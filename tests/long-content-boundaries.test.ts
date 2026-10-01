import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  DIARY_CONTENT_MAX_LENGTH,
} from "../src/domains/resource-limits.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const DIARY_ID = "00000000-0000-4000-8000-000000000102";
const LONG_CONTENT = "蕾".repeat(100_000);
const OVER_LIMIT_CONTENT = "蕾".repeat(100_001);

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
  const calls = { writeDiary: 0, updateDiary: 0 };
  const server = createMcpServer({
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

test("Diary canonical content limits are exactly 100,000 units", () => {
  assert.equal(DIARY_CONTENT_MAX_LENGTH, 100_000);
  assert.equal(LONG_CONTENT.length, 100_000);
  assert.equal("😀".repeat(50_000).length, 100_000);
});

test("Diary MCP write/update adapters accept the canonical 100k boundary", async (t) => {
  const { client, server, calls } = await connect();
  t.after(async () => { await client.close(); await server.close(); });

  const responses = await Promise.all([
    client.callTool({ name: "create_diary", arguments: { title: "Long diary", content: LONG_CONTENT, date: "2026-08-25", tags: [], author: "G", idempotency_key: "long-diary-00001" } }),
    client.callTool({ name: "update_diary", arguments: { id: DIARY_ID, content: LONG_CONTENT } }),
  ]);

  assert.deepEqual(responses.map((response) => response.isError), [undefined, undefined], JSON.stringify(responses.map((response) => response.content)));
  assert.deepEqual(calls, { writeDiary: 1, updateDiary: 1 });
});

test("Diary MCP write/update adapters reject content above the canonical boundary", async (t) => {
  const { client, server, calls } = await connect();
  t.after(async () => { await client.close(); await server.close(); });

  const responses = await Promise.all([
    client.callTool({ name: "create_diary", arguments: { title: "Long diary", content: OVER_LIMIT_CONTENT, date: "2026-08-25", tags: [], author: "G", idempotency_key: "long-diary-00002" } }),
    client.callTool({ name: "update_diary", arguments: { id: DIARY_ID, content: OVER_LIMIT_CONTENT } }),
  ]);

  assert.deepEqual(responses.map((response) => response.isError), [true, true]);
  assert.deepEqual(calls, { writeDiary: 0, updateDiary: 0 });
});
