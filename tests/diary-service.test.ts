import assert from "node:assert/strict";
import test from "node:test";
import type {
  DiaryAuditRequestSummary,
  DiaryRepository,
  DiaryUserRecord,
  NormalizedDiaryCreate,
  PersistDiaryResult,
} from "../src/domains/diary/diary-repository.js";
import {
  DiaryDomainError,
  DiaryService,
  type CreateDiaryInput,
} from "../src/domains/diary/diary-service.js";

const VALID_INPUT: CreateDiaryInput = {
  title: "  今天的记录  ",
  content: "  完成了 Diary Domain Layer。  ",
  date: "2026-07-22",
  tags: [" 项目 ", "MCP", "项目"],
  mood: " 开心 ",
  idempotencyKey: "diary-20260722-0001",
};

class MockDiaryRepository implements DiaryRepository {
  user: DiaryUserRecord | null = { status: "active" };
  outcome: PersistDiaryResult["outcome"] = "created";
  findUserCalls: string[] = [];
  writes: Array<{
    diary: NormalizedDiaryCreate;
    summary: DiaryAuditRequestSummary;
    mcpWriteIdempotency: boolean;
  }> = [];

  async findUserById(userId: string): Promise<DiaryUserRecord | null> {
    this.findUserCalls.push(userId);
    return this.user;
  }

  async createDiaryWithAudit(
    diary: NormalizedDiaryCreate,
    summary: DiaryAuditRequestSummary,
    options?: { mcpWriteIdempotency?: boolean },
  ): Promise<PersistDiaryResult> {
    this.writes.push({ diary, summary, mcpWriteIdempotency: options?.mcpWriteIdempotency === true });

    if (this.outcome === "conflict") {
      return { outcome: "conflict" };
    }

    return {
      outcome: this.outcome,
      diary: {
        id: "00000000-0000-4000-8000-000000000001",
        title: diary.title,
        date: diary.date,
        tags: diary.tags,
        mood: diary.mood,
        createdAt: new Date("2026-07-22T08:00:00.000Z"),
        requestHash: diary.requestHash,
      },
    };
  }
}

test("Diary MCP creation enables durable idempotency without changing Web creation", async () => {
  const repository = new MockDiaryRepository();
  const service = new DiaryService(repository);
  await service.createMcpDiary({ userId: "user-1" }, VALID_INPUT);
  assert.equal(repository.writes[0]?.mcpWriteIdempotency, true);
  await service.createDiary({ userId: "user-1" }, { ...VALID_INPUT, idempotencyKey: "diary-web-compatible-0001" });
  assert.equal(repository.writes[1]?.mcpWriteIdempotency, false);
  assert.equal(repository.writes[0]?.diary.requestHash, repository.writes[1]?.diary.requestHash);
  assert.notEqual(repository.writes[0]?.diary.mcpRequestHash, repository.writes[0]?.diary.requestHash);
});

test("creates a normalized diary using only the authenticated context user", async () => {
  const repository = new MockDiaryRepository();
  const service = new DiaryService(repository);

  const result = await service.createDiary(
    { userId: "00000000-0000-4000-8000-000000000099" },
    VALID_INPUT,
  );

  assert.deepEqual(repository.findUserCalls, [
    "00000000-0000-4000-8000-000000000099",
  ]);
  assert.equal(repository.writes.length, 1);

  const write = repository.writes[0]!;
  assert.equal(write.diary.userId, "00000000-0000-4000-8000-000000000099");
  assert.equal(write.diary.title, "今天的记录");
  assert.equal(write.diary.content, "完成了 Diary Domain Layer。");
  assert.deepEqual(write.diary.tags, ["项目", "MCP"]);
  assert.equal(write.diary.mood, "开心");
  assert.match(write.diary.requestHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(write.summary, {
    title_length: 5,
    content_length: 23,
    date: "2026-07-22",
    tag_count: 2,
    has_mood: true,
  });
  assert.equal("content" in write.summary, false);
  assert.equal("title" in write.summary, false);
  assert.deepEqual(result.metadata, {
    created: true,
    idempotent_replay: false,
  });
});

test("produces the same request hash for equivalent normalized input", async () => {
  const repository = new MockDiaryRepository();
  const service = new DiaryService(repository);

  await service.createDiary({ userId: "user-1" }, VALID_INPUT);
  await service.createDiary(
    { userId: "user-1" },
    {
      ...VALID_INPUT,
      title: "今天的记录",
      content: "完成了 Diary Domain Layer。",
      tags: ["项目", "MCP"],
      mood: "开心",
    },
  );

  assert.equal(
    repository.writes[0]!.diary.requestHash,
    repository.writes[1]!.diary.requestHash,
  );
});

test("returns replay metadata for an idempotent replay", async () => {
  const repository = new MockDiaryRepository();
  repository.outcome = "replayed";
  const service = new DiaryService(repository);

  const result = await service.createDiary({ userId: "user-1" }, VALID_INPUT);

  assert.deepEqual(result.metadata, {
    created: false,
    idempotent_replay: true,
  });
});

test("rejects reuse of an idempotency key with a different request hash", async () => {
  const repository = new MockDiaryRepository();
  repository.outcome = "conflict";
  const service = new DiaryService(repository);

  await assert.rejects(
    service.createDiary({ userId: "user-1" }, VALID_INPUT),
    (error: unknown) =>
      error instanceof DiaryDomainError &&
      error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("rejects disabled users before attempting a diary write", async () => {
  const repository = new MockDiaryRepository();
  repository.user = { status: "disabled" };
  const service = new DiaryService(repository);

  await assert.rejects(
    service.createDiary({ userId: "user-1" }, VALID_INPUT),
    (error: unknown) =>
      error instanceof DiaryDomainError && error.code === "USER_DISABLED",
  );
  assert.equal(repository.writes.length, 0);
});

test("requires a user identity from the authenticated context", async () => {
  const repository = new MockDiaryRepository();
  const service = new DiaryService(repository);

  await assert.rejects(
    service.createDiary({ userId: "  " }, VALID_INPUT),
    (error: unknown) =>
      error instanceof DiaryDomainError &&
      error.code === "INVALID_AUTHENTICATED_USER",
  );
  assert.equal(repository.findUserCalls.length, 0);
  assert.equal(repository.writes.length, 0);
});

test("rejects invalid calendar dates and malformed idempotency keys", async () => {
  const repository = new MockDiaryRepository();
  const service = new DiaryService(repository);

  await assert.rejects(
    service.createDiary(
      { userId: "user-1" },
      { ...VALID_INPUT, date: "2026-02-30" },
    ),
    (error: unknown) =>
      error instanceof DiaryDomainError && error.code === "INVALID_DATE",
  );

  await assert.rejects(
    service.createDiary(
      { userId: "user-1" },
      { ...VALID_INPUT, idempotencyKey: "too short" },
    ),
    (error: unknown) =>
      error instanceof DiaryDomainError &&
      error.code === "INVALID_IDEMPOTENCY_KEY",
  );
});
