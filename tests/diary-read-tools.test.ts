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
  id: "legacy-diary-id",
  title: "完整日记",
  content: "完整的私人日记正文。",
  date: "2026-07-28",
  tags: ["旅行", "夏天"],
  mood: "开心",
  created_at: "2026-07-28T08:00:00.000Z",
  updated_at: "2026-07-29T08:00:00.000Z",
};

class MockDiaryService {
  listCalls: ListDiariesInput[] = [];
  readCalls: ReadDiaryInput[] = [];
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
      limit: 12,
    },
  });
  assert.deepEqual(service.listCalls, [{
    userId: USER_ID,
    limit: 12,
    query: {
      q: "海边",
      tag: "旅行",
      mood: "开心",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
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
      }],
      metadata: { count: 1 },
    },
  });
});

test("search_diary supports no filters and rejects invalid schemas", async () => {
  const service = new MockDiaryService();
  const pair = await connect(service);
  await pair.client.callTool({ name: "search_diary", arguments: {} });
  assert.deepEqual(service.listCalls[0], {
    userId: USER_ID,
    limit: undefined,
    query: {
      q: undefined,
      tag: undefined,
      mood: undefined,
      dateFrom: undefined,
      dateTo: undefined,
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
  assert.deepEqual(result.structuredContent, { success: true, data: ENTRY });
});

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
    arguments: { id: "legacy-readable-id" },
  });
  assert.equal(service.readCalls[0]?.id, "legacy-readable-id");
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
    arguments: { id: "inaccessible" },
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
      idempotency_key: "diary-read-regression-0001",
    },
  });
  assert.equal(write.isError, undefined);
  assert.equal(service.writeCalls[0]?.context.userId, USER_ID);
  await pair.client.close();
  await pair.server.close();
});
