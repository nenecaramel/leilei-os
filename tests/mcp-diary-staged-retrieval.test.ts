import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const DIARY_ID = "diary-staged-1";
const BODY = `${"前".repeat(180)} bodyneedle ${"后".repeat(180)}`;
const diary = {
  id: DIARY_ID,
  title: "title needle",
  content: BODY,
  date: "2026-08-25",
  tags: ["travel"],
  mood: "focused",
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
  author: "G" as const,
};

async function connect() {
  const service = {
    async searchDiaryDiscovery(input: { query?: { q?: string } }) {
      return {
        diaries: [{
          id: DIARY_ID,
          title: diary.title,
          date: diary.date,
          tags: diary.tags,
          mood: diary.mood,
          created_at: diary.created_at,
          updated_at: diary.updated_at,
          author: diary.author,
          snippet: input.query?.q === "bodyneedle" ? "bodyneedle" : null,
        }],
        metadata: { count: 1 },
      };
    },
    async listDiaries(input: { query?: { q?: string } }) {
      return { diaries: [diary], metadata: { count: input.query?.q ? 1 : 1 } };
    },
    async readDiary() { return diary; },
    async readArchivedDiary() { return diary; },
    async createMcpDiary() { throw new Error("not used"); },
  };
  const server = createMcpServer({
    diaryTools: { diaryService: service, getAuthenticatedUserId: () => USER_ID },
  });
  const client = new Client({ name: "diary-staged-retrieval", version: "1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("search_diary returns compact metadata, nullable body snippet, and get_diary pointer", async (t) => {
  const { client, server } = await connect();
  t.after(async () => { await client.close(); await server.close(); });
  const titleOnly = await client.callTool({ name: "search_diary", arguments: { query: "title needle" } });
  const titleItem = (titleOnly.structuredContent as { data: { diaries: Array<Record<string, unknown>> } }).data.diaries[0]!;
  assert.equal("content" in titleItem, false);
  assert.equal(titleItem.snippet, null);
  assert.equal(titleItem.detail_tool, "get_diary");
  assert.deepEqual(titleItem.detail_arguments, { id: DIARY_ID, scope: "active" });

  const bodyMatch = await client.callTool({ name: "search_diary", arguments: { query: "bodyneedle" } });
  const bodyItem = (bodyMatch.structuredContent as { data: { diaries: Array<Record<string, unknown>> } }).data.diaries[0]!;
  assert.match(String(bodyItem.snippet), /bodyneedle/);
  assert.equal(Array.from(String(bodyItem.snippet)).length <= 240, true);

  const filtersOnly = await client.callTool({ name: "search_diary", arguments: { tag: "travel" } });
  const filterItem = (filtersOnly.structuredContent as { data: { diaries: Array<Record<string, unknown>> } }).data.diaries[0]!;
  assert.equal(filterItem.snippet, null);

  const detail = await client.callTool({ name: "get_diary", arguments: { id: DIARY_ID } });
  assert.equal((detail.structuredContent as { data: { content: string } }).data.content, BODY);
});
