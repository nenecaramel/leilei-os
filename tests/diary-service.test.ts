import assert from "node:assert/strict";
import test from "node:test";
import type {
  DiaryAuditRequestSummary,
  DiaryEntryRecord,
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
  author: "L",
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
        author: diary.author,
      },
    };
  }

  async findDiaryById(): Promise<DiaryEntryRecord | null> {
    return null;
  }
  async listActiveContentDates(): Promise<string[]> { return []; }
  async findActiveByDate(): Promise<DiaryEntryRecord[]> { return []; }

  async updateDiary(): Promise<DiaryEntryRecord | null> {
    return null;
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

test("Diary MCP partial update forwards only supplied fields and returns fresh detail", async () => {
  const repository = new MockDiaryRepository();
  let current: DiaryEntryRecord = {
    id: "diary-1",
    title: "Original title",
    content: "Original content",
    date: "2026-08-20",
    tags: ["keep"],
    mood: "calm",
    author: "L",
    createdAt: new Date("2026-08-20T01:00:00Z"),
    updatedAt: new Date("2026-08-20T02:00:00Z"),
  };
  repository.findDiaryById = async (userId, id) => {
    assert.equal(userId, "user-1");
    assert.equal(id, "diary-1");
    return current;
  };
  const writes: unknown[] = [];
  repository.updateDiary = async (input) => {
    writes.push(input);
    current = {
      ...current,
      ...input,
      updatedAt: new Date("2026-08-20T03:00:00Z"),
    };
    return current;
  };
  const service = new DiaryService(repository);

  const result = await service.updateMcpDiary(
    { userId: "user-1" },
    { id: " diary-1 ", content: " Updated content ", tags: [], mood: null },
  );

  assert.deepEqual(writes, [{
    userId: "user-1",
    id: "diary-1",
    content: "Updated content",
    tags: [],
    mood: null,
  }]);
  assert.equal(result.content, "Updated content");
  assert.equal(result.title, "Original title");
  assert.equal(result.date, "2026-08-20");
  assert.deepEqual(result.tags, []);
  assert.equal(result.mood, null);
  assert.equal(result.author, "L");
});

test("Diary MCP partial update rejects an empty patch before mutation", async () => {
  const repository = new MockDiaryRepository();
  let mutated = false;
  repository.findDiaryById = async () => ({
    id: "diary-1",
    title: "Title",
    content: "Content",
    date: "2026-08-20",
    tags: [],
    mood: null,
    author: null,
    createdAt: new Date("2026-08-20T01:00:00Z"),
    updatedAt: new Date("2026-08-20T02:00:00Z"),
  });
  repository.updateDiary = async () => {
    mutated = true;
    return null;
  };
  const service = new DiaryService(repository);

  await assert.rejects(
    service.updateMcpDiary({ userId: "user-1" }, { id: "diary-1" }),
    (error: unknown) => error instanceof DiaryDomainError && error.code === "INVALID_DIARY_PATCH",
  );
  assert.equal(mutated, false);
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
  assert.equal(write.diary.author, "L");
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

test("Diary content-date and exact-date reads validate and preserve all durable fields", async () => {
  const repository = new MockDiaryRepository();
  const entry: DiaryEntryRecord = {
    id: "d-date",
    title: "Exact",
    content: "Body",
    date: "2026-08-12",
    tags: ["keep"],
    mood: "calm",
    author: null,
    createdAt: new Date("2026-08-12T01:00:00Z"),
    updatedAt: new Date("2026-08-12T02:00:00Z"),
  };
  repository.listActiveContentDates = async (userId) => {
    assert.equal(userId, "user-1");
    return ["2026-08-12", "2026-08-01"];
  };
  repository.findActiveByDate = async (userId, date) => {
    assert.equal(userId, "user-1");
    assert.equal(date, "2026-08-12");
    return [entry];
  };
  const service = new DiaryService(repository);
  assert.deepEqual(await service.listDiaryContentDates({ userId: "user-1" }), {
    dates: ["2026-08-12", "2026-08-01"],
  });
  assert.deepEqual(await service.listDiariesByDate({ userId: "user-1", date: " 2026-08-12 " }), {
    date: "2026-08-12",
    diaries: [{
      id: entry.id,
      title: entry.title,
      content: entry.content,
      date: entry.date,
      tags: entry.tags,
      mood: entry.mood,
      author: entry.author,
      created_at: entry.createdAt.toISOString(),
      updated_at: entry.updatedAt.toISOString(),
    }],
  });
  await assert.rejects(
    service.listDiariesByDate({ userId: "user-1", date: "2026-02-30" }),
    (error: unknown) => error instanceof DiaryDomainError && error.code === "INVALID_DATE",
  );
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

test("Diary C creation preserves C and includes author in canonical idempotency", async () => {
  const repository = new MockDiaryRepository();
  let firstWrite: NormalizedDiaryCreate | undefined;
  repository.createDiaryWithAudit = async (diary) => {
    if (firstWrite) {
      if (firstWrite.requestHash !== diary.requestHash) {
        return { outcome: "conflict" };
      }
      return {
        outcome: "replayed",
        diary: {
          id: "00000000-0000-4000-8000-000000000001",
          title: firstWrite.title,
          date: firstWrite.date,
          tags: firstWrite.tags,
          mood: firstWrite.mood,
          author: firstWrite.author,
          createdAt: new Date("2026-09-05T08:00:00.000Z"),
          requestHash: firstWrite.requestHash,
        },
      };
    }
    firstWrite = diary;
    return {
      outcome: "created",
      diary: {
        id: "00000000-0000-4000-8000-000000000001",
        title: diary.title,
        date: diary.date,
        tags: diary.tags,
        mood: diary.mood,
        author: diary.author,
        createdAt: new Date("2026-09-05T08:00:00.000Z"),
        requestHash: diary.requestHash,
      },
    };
  };
  const service = new DiaryService(repository);
  const input = {
    title: "Claude diary",
    content: "A C-authored entry.",
    date: "2026-09-05",
    tags: [],
    author: "C" as const,
    idempotencyKey: "diary-c-author-0001",
  };

  const created = await service.createDiary({ userId: "user-1" }, input);
  const replayed = await service.createDiary({ userId: "user-1" }, input);
  await assert.rejects(
    service.createDiary({ userId: "user-1" }, { ...input, author: "G" }),
    (error: unknown) => error instanceof DiaryDomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );

  assert.equal(created.diary.author, "C");
  assert.equal(replayed.diary.author, "C");
  assert.deepEqual(replayed.metadata, { created: false, idempotent_replay: true });
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

for (const author of [undefined, "X"] as const) {
  test("Diary create rejects missing or invalid author before persistence", async () => {
    const repository = new MockDiaryRepository();
    const service = new DiaryService(repository);

    await assert.rejects(
      service.createDiary(
        { userId: "user-1" },
        { ...VALID_INPUT, author: author as any },
      ),
      (error: unknown) =>
        error instanceof DiaryDomainError &&
        error.code === "AUTHOR_REQUIRED",
    );
    assert.equal(repository.writes.length, 0);
  });
}

test("Diary legacy-null content edits require and persist an explicit author", async () => {
  const repository = new MockDiaryRepository();
  let entry: DiaryEntryRecord | null = {
    id: "diary-1",
    title: "Old title",
    content: "Old content",
    date: "2026-07-22",
    tags: [],
    mood: null,
    author: null,
    createdAt: new Date("2026-07-22T08:00:00.000Z"),
    updatedAt: new Date("2026-07-22T08:00:00.000Z"),
  };
  const updates: unknown[] = [];
  repository.findDiaryById = async () => entry;
  repository.updateDiary = async (input) => {
    updates.push(input);
    entry = { ...entry!, ...input, author: input.author ?? entry!.author };
    return entry;
  };

  const service = new DiaryService(repository);
  const base = {
    userId: "user-1",
    id: "diary-1",
    title: "New title",
    content: "New content",
    date: "2026-07-23",
  };
  await assert.rejects(
    service.updateWebDiary(base),
    (error: unknown) =>
      error instanceof DiaryDomainError &&
      error.code === "AUTHOR_REQUIRED",
  );
  assert.equal(updates.length, 0);

  await service.updateWebDiary({ ...base, author: "G" });
  assert.equal(updates[0] && (updates[0] as { author: string }).author, "G");
  assert.equal(entry?.author, "G");
});

test("Diary authored edits preserve or explicitly switch author", async () => {
  const repository = new MockDiaryRepository();
  let entry: DiaryEntryRecord = {
    id: "diary-1",
    title: "Old title",
    content: "Old content",
    date: "2026-07-22",
    tags: [],
    mood: null,
    author: "L",
    createdAt: new Date("2026-07-22T08:00:00.000Z"),
    updatedAt: new Date("2026-07-22T08:00:00.000Z"),
  };
  const authors: unknown[] = [];
  repository.findDiaryById = async () => entry;
  repository.updateDiary = async (input) => {
    authors.push(input.author);
    entry = { ...entry, ...input, author: input.author ?? entry.author };
    return entry;
  };
  const service = new DiaryService(repository);
  const base = {
    userId: "user-1",
    id: "diary-1",
    title: "New title",
    content: "New content",
    date: "2026-07-23",
  };
  await service.updateWebDiary(base);
  await service.updateWebDiary({ ...base, author: "C" });
  assert.deepEqual(authors, ["L", "C"]);
  assert.equal(entry.author, "C");
});

test("Diary rejects invalid authors before a C edit can mutate", async () => {
  const repository = new MockDiaryRepository();
  let updates = 0;
  repository.findDiaryById = async () => ({
    id: "diary-c",
    title: "Claude diary",
    content: "A C-authored entry.",
    date: "2026-09-05",
    tags: [],
    mood: null,
    author: "C",
    createdAt: new Date("2026-09-05T08:00:00.000Z"),
    updatedAt: new Date("2026-09-05T08:00:00.000Z"),
  });
  repository.updateDiary = async () => {
    updates += 1;
    return null;
  };
  const service = new DiaryService(repository);

  await assert.rejects(
    service.updateMcpDiary(
      { userId: "user-1" },
      { id: "diary-c", content: "Edited by Claude.", author: "Claude" as any },
    ),
    (error: unknown) => error instanceof DiaryDomainError && error.code === "AUTHOR_REQUIRED",
  );
  assert.equal(updates, 0);
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
