import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  DiaryDomainError,
  type AuthenticatedDiaryContext,
  type CreateDiaryInput,
  type CreateDiaryResult,
  type DiaryEntryResult,
  type ListDiariesInput,
  type ListDiariesResult,
  type ReadDiaryInput,
} from "../src/domains/diary/diary-service.js";
import { createMcpServer } from "../src/mcp/server/create-server.js";
import { DiaryReadAuthenticationError } from "../src/mcp/tools/search-diary/register.js";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const ENTRY: DiaryEntryResult = {
  id: "00000000-0000-4000-8000-000000000308",
  title: "完整日记",
  content: "完整的私人日记正文。",
  date: "2026-07-28",
  tags: ["旅行", "夏天"],
  mood: "开心",
  created_at: "2026-07-28T08:00:00.000Z",
  updated_at: "2026-07-29T08:00:00.000Z",
  author: "G",
};

class MockDiaryService {
  listCalls: ListDiariesInput[] = [];
  readCalls: ReadDiaryInput[] = [];
  archivedReadCalls: ReadDiaryInput[] = [];
  writeCalls: Array<{
    context: AuthenticatedDiaryContext;
    input: CreateDiaryInput;
  }> = [];
  listError?: unknown;
  readError?: unknown;

  async listDiaries(input: ListDiariesInput): Promise<ListDiariesResult> {
    this.listCalls.push(input);
    if (this.listError) throw this.listError;
    return { diaries: [ENTRY], metadata: { count: 1 } };
  }

  async readDiary(input: ReadDiaryInput): Promise<DiaryEntryResult> {
    this.readCalls.push(input);
    if (this.readError) throw this.readError;
    return ENTRY;
  }
  async readArchivedDiary(input: ReadDiaryInput): Promise<DiaryEntryResult> { this.archivedReadCalls.push(input); return ENTRY; }

  async createMcpDiary(
    context: AuthenticatedDiaryContext,
    input: CreateDiaryInput,
  ): Promise<CreateDiaryResult> {
    this.writeCalls.push({ context, input });
    return {
      diary: {
        id: "00000000-0000-4000-8000-000000000001",
        title: input.title,
        date: input.date,
        tags: [...input.tags],
        mood: input.mood ?? null,
        created_at: ENTRY.created_at,
        author: input.author,
      },
      metadata: { created: true, idempotent_replay: false },
    };
  }
}

async function connect(
  service: MockDiaryService,
  getAuthenticatedUserId: () => string = () => USER_ID,
) {
  const server = createMcpServer({
    diaryTools: { diaryService: service, getAuthenticatedUserId },
  });
  const client = new Client(
    { name: "diary-read-tools-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const first = result.content[0];
  return first && "text" in first ? String(first.text) : "";
}

test("Diary reads are registered read-only without changing write_diary", async (t) => {
  const { client, server } = await connect(new MockDiaryService());
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const tools = await client.listTools();
  for (const name of ["search_diary", "get_diary"]) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    assert.ok(tool);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    assert.equal("userId" in (tool.inputSchema.properties ?? {}), false);
    assert.equal("user_id" in (tool.inputSchema.properties ?? {}), false);
  }
  assert.equal(
    tools.tools.find((tool) => tool.name === "write_diary")?.annotations
      ?.readOnlyHint,
    false,
  );
});

test("search_diary maps filters and identity but omits content", async (t) => {
  const service = new MockDiaryService();
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({
    name: "search_diary",
    arguments: {
      query: "  海边  ",
      tag: "  旅行  ",
      mood: "  开心  ",
      date_from: "2026-07-01",
      date_to: "2026-07-31",
      author: "G",
      limit: 12,
    },
  });
  assert.deepEqual(service.listCalls, [{
    userId: USER_ID,
    limit: 13,
    offset: 0,
    query: {
      q: "海边",
      tag: "旅行",
      mood: "开心",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      author: "G",
    },
  }]);
  const serialized = JSON.stringify(result.structuredContent);
  assert.equal(serialized.includes(ENTRY.content), false);
  assert.equal(serialized.includes('"content"'), false);
  assert.equal(serialized.includes("source"), false);
  assert.equal(serialized.includes("idempotency"), false);
  assert.deepEqual(result.structuredContent, {
    success: true,
    data: {
      diaries: [{
        id: ENTRY.id,
        title: ENTRY.title,
        date: ENTRY.date,
        tags: ENTRY.tags,
        mood: ENTRY.mood,
        created_at: ENTRY.created_at,
        updated_at: ENTRY.updated_at,
        author: ENTRY.author,
        snippet: null,
        detail_tool: "get_diary",
        detail_arguments: { id: ENTRY.id, scope: "active" },
      }],
      metadata: { count: 1, returned: 1, has_more: false, next_cursor: null },
    },
  });
});

test("search_diary supports no filters and rejects invalid schemas", async () => {
  const service = new MockDiaryService();
  const pair = await connect(service);
  await pair.client.callTool({ name: "search_diary", arguments: {} });
  assert.deepEqual(service.listCalls[0], {
    userId: USER_ID,
    limit: 51,
    offset: 0,
    query: {
      q: undefined,
      tag: undefined,
      mood: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      author: undefined,
    },
  });
  await pair.client.close();
  await pair.server.close();

  for (const arguments_ of [
    { tag: "" },
    { mood: "" },
    { date_from: "tomorrow" },
    { limit: 0 },
    { limit: 51 },
    { query: "x".repeat(201) },
    { author: "Claude" },
    { author: " G " },
    { user_id: USER_ID },
  ]) {
    const invalidService = new MockDiaryService();
    const invalidPair = await connect(invalidService);
    const result = await invalidPair.client.callTool({
      name: "search_diary",
      arguments: arguments_,
    });
    assert.equal(result.isError, true);
    assert.equal(invalidService.listCalls.length, 0);
    await invalidPair.client.close();
    await invalidPair.server.close();
  }
});

test("search_diary maps domain, user, and unexpected errors safely", async () => {
  for (const [error, expected, secret] of [
    [
      new DiaryDomainError("INVALID_DIARY_QUERY", "private range"),
      /Diary search is invalid/,
      "private range",
    ],
    [
      new DiaryDomainError("USER_DISABLED", "private user"),
      /unavailable for the authenticated user/,
      "private user",
    ],
    [
      new DiaryDomainError("USER_NOT_FOUND", "missing private user"),
      /unavailable for the authenticated user/,
      "missing private user",
    ],
    [new Error("SQL password"), /temporarily unavailable/, "SQL password"],
  ] as const) {
    const service = new MockDiaryService();
    service.listError = error;
    const pair = await connect(service);
    const result = await pair.client.callTool({
      name: "search_diary",
      arguments: { date_from: "2026-07-31", date_to: "2026-07-01" },
    });
    assert.match(textOf(result), expected);
    assert.equal(textOf(result).includes(secret), false);
    await pair.client.close();
    await pair.server.close();
  }
});

test("get_diary injects identity and returns complete content", async (t) => {
  const service = new MockDiaryService();
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  const result = await client.callTool({
    name: "get_diary",
    arguments: { id: `  ${ENTRY.id}  ` },
  });
  assert.deepEqual(service.readCalls, [{ userId: USER_ID, id: ENTRY.id }]);
  const data = (result.structuredContent as {
    data: {
      content: string;
      lifecycle_status: string;
      content_metadata: {
        returned_chars: number;
        total_chars: number;
        truncated: boolean;
        next_cursor: string | null;
      };
      comments_tool: string;
      comments_arguments: { diary_id: string; scope: string };
    };
  }).data;
  assert.equal(data.content, ENTRY.content);
  assert.equal(data.lifecycle_status, "active");
  assert.deepEqual(data.content_metadata, {
    returned_chars: Array.from(ENTRY.content).length,
    total_chars: Array.from(ENTRY.content).length,
    truncated: false,
    next_cursor: null,
  });
  assert.equal(data.comments_tool, "list_diary_comments");
  assert.deepEqual(data.comments_arguments, { diary_id: ENTRY.id, scope: "active" });
});

test("get_diary continues bounded content without embedding comments", async (t) => {
  const service = new MockDiaryService();
  let updatedAt = ENTRY.updated_at;
  service.readDiary = async (input) => {
    service.readCalls.push(input);
    return {
      ...ENTRY,
      content: "甲😀乙丙丁",
      updated_at: updatedAt,
    };
  };
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const first = await client.callTool({
    name: "get_diary",
    arguments: { id: ENTRY.id, max_chars: 2 },
  });
  const firstData = (first.structuredContent as {
    data: {
      content: string;
      content_metadata: { next_cursor: string | null; truncated: boolean };
      comments_tool: string;
      comments_arguments: { diary_id: string; scope: string };
    };
  }).data;
  assert.equal(firstData.content, "甲😀");
  assert.equal(firstData.content_metadata.truncated, true);
  assert.ok(firstData.content_metadata.next_cursor);
  assert.equal(firstData.comments_tool, "list_diary_comments");
  assert.deepEqual(firstData.comments_arguments, {
    diary_id: ENTRY.id,
    scope: "active",
  });

  const second = await client.callTool({
    name: "get_diary",
    arguments: {
      id: ENTRY.id,
      max_chars: 2,
      cursor: firstData.content_metadata.next_cursor,
    },
  });
  assert.equal(
    (second.structuredContent as { data: { content: string } }).data.content,
    "乙丙",
  );

  updatedAt = "2026-07-31T08:00:00.000Z";
  const stale = await client.callTool({
    name: "get_diary",
    arguments: {
      id: ENTRY.id,
      max_chars: 2,
      cursor: firstData.content_metadata.next_cursor,
    },
  });
  assert.equal(stale.isError, true);
  assert.match(textOf(stale), /cursor is invalid or stale/i);
});

test("Diary search and detail preserve C author", async (t) => {
  const service = new MockDiaryService();
  const cEntry = { ...ENTRY, author: "C" as const };
  service.listDiaries = async () => ({ diaries: [cEntry], metadata: { count: 1 } });
  service.readDiary = async () => cEntry;
  const { client, server } = await connect(service);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const search = await client.callTool({ name: "search_diary", arguments: {} });
  const detail = await client.callTool({ name: "get_diary", arguments: { id: cEntry.id } });

  assert.equal(search.isError, undefined);
  assert.equal(detail.isError, undefined);
  assert.equal((search.structuredContent as { data: { diaries: Array<{ author: string }> } }).data.diaries[0]?.author, "C");
  assert.equal((detail.structuredContent as { data: { author: string } }).data.author, "C");
});

test("get_diary archived scope uses only archived detail",async(t)=>{const service=new MockDiaryService();const {client,server}=await connect(service);t.after(async()=>{await client.close();await server.close();});const result=await client.callTool({name:"get_diary",arguments:{id:ENTRY.id,scope:"archived"}});assert.equal(result.isError,undefined);assert.equal(service.readCalls.length,0);assert.deepEqual(service.archivedReadCalls,[{userId:USER_ID,id:ENTRY.id}]);assert.equal((result.structuredContent as {data:{lifecycle_status:string}}).data.lifecycle_status,"archived");});

test("get_diary rejects empty ids and hides inaccessible records", async () => {
  const service = new MockDiaryService();
  const pair = await connect(service);
  const invalid = await pair.client.callTool({
    name: "get_diary",
    arguments: { id: " " },
  });
  assert.equal(invalid.isError, true);
  assert.equal(service.readCalls.length, 0);
  await pair.client.callTool({
    name: "get_diary",
    arguments: { id: ENTRY.id },
  });
  assert.equal(service.readCalls[0]?.id, ENTRY.id);
  await pair.client.close();
  await pair.server.close();

  const hidden = new MockDiaryService();
  hidden.readError = new DiaryDomainError(
    "DIARY_NOT_FOUND",
    "cross-user diary exists",
  );
  const hiddenPair = await connect(hidden);
  const result = await hiddenPair.client.callTool({
    name: "get_diary",
    arguments: { id: ENTRY.id },
  });
  assert.equal(textOf(result), "Diary entry was not found.");
  assert.doesNotMatch(textOf(result), /cross-user|exists/i);
  await hiddenPair.client.close();
  await hiddenPair.server.close();
});

test("get_diary maps unavailable and unexpected failures safely", async () => {
  for (const [error, expected, secret] of [
    [
      new DiaryDomainError("USER_NOT_FOUND", "private user id"),
      /unavailable for the authenticated user/,
      "private user id",
    ],
    [
      new DiaryDomainError("USER_DISABLED", "disabled private user"),
      /unavailable for the authenticated user/,
      "disabled private user",
    ],
    [new Error("SQL SELECT diary"), /temporarily unavailable/, "SQL SELECT"],
  ] as const) {
    const service = new MockDiaryService();
    service.readError = error;
    const pair = await connect(service);
    const result = await pair.client.callTool({
      name: "get_diary",
      arguments: { id: ENTRY.id },
    });
    assert.match(textOf(result), expected);
    assert.equal(textOf(result).includes(secret), false);
    await pair.client.close();
    await pair.server.close();
  }
});

test("Diary reads require auth and shared write_diary remains compatible", async () => {
  const unauthenticated = new MockDiaryService();
  const unauthPair = await connect(unauthenticated, () => {
    throw new DiaryReadAuthenticationError();
  });
  for (const request of [
    { name: "search_diary", arguments: {} },
    { name: "get_diary", arguments: { id: ENTRY.id } },
  ]) {
    const result = await unauthPair.client.callTool(request);
    assert.match(textOf(result), /Authentication is required/i);
  }
  assert.equal(unauthenticated.listCalls.length, 0);
  assert.equal(unauthenticated.readCalls.length, 0);
  await unauthPair.client.close();
  await unauthPair.server.close();

  const service = new MockDiaryService();
  const pair = await connect(service);
  const write = await pair.client.callTool({
    name: "write_diary",
    arguments: {
      title: "原写入工具",
      content: "现有写入契约保持不变。",
      date: "2026-07-29",
      tags: [],
      author: "L",
      idempotency_key: "diary-read-regression-0001",
    },
  });
  assert.equal(write.isError, undefined);
  assert.equal(service.writeCalls[0]?.context.userId, USER_ID);
  await pair.client.close();
  await pair.server.close();
});
