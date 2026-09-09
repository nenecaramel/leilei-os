import assert from "node:assert/strict";
import test from "node:test";
import type {
  DiaryEntryRecord,
  DiaryListQuery,
  DiaryRepository,
} from "../src/domains/diary/diary-repository.js";
import {
  DiaryDomainError,
  DiaryService,
} from "../src/domains/diary/diary-service.js";

const entries: DiaryEntryRecord[] = [
  {
    id: "d1",
    title: "Japan Trip",
    content: "Literal 100% _complete_ \\ path",
    date: "2026-07-07",
    tags: ["日本", "filter-test"],
    mood: "happy",
    author: "L",
    createdAt: new Date("2026-07-07T08:00:00Z"),
    updatedAt: new Date("2026-07-07T08:00:00Z"),
  },
  {
    id: "d2",
    title: "filter",
    content: "旅行记录与意识",
    date: "2026-07-01",
    tags: ["filter"],
    mood: "calm",
    author: "G",
    createdAt: new Date("2026-07-01T08:00:00Z"),
    updatedAt: new Date("2026-07-01T08:00:00Z"),
  },
  {
    id: "d3",
    title: "C note",
    content: "C 专属记录",
    date: "2026-06-01",
    tags: ["c-filter"],
    mood: "focused",
    author: "C",
    createdAt: new Date("2026-06-01T08:00:00Z"),
    updatedAt: new Date("2026-06-01T08:00:00Z"),
  },
];

class SearchRepository implements DiaryRepository {
  calls: Array<{ userId: string; limit: number; query: DiaryListQuery }> = [];
  async findUserById() {
    return { status: "active" as const };
  }
  private matchingEntries(query: DiaryListQuery) {
    return entries.filter((entry) => {
      const q = query.q?.toLocaleLowerCase();
      return (
        (!q ||
          entry.title.toLocaleLowerCase().includes(q) ||
          entry.content.toLocaleLowerCase().includes(q)) &&
        (!query.tag || entry.tags.includes(query.tag)) &&
        (!query.mood || entry.mood === query.mood) &&
        (!query.author || entry.author === query.author) &&
        (!query.dateFrom || entry.date >= query.dateFrom) &&
        (!query.dateTo || entry.date <= query.dateTo)
      );
    });
  }

  async findDiaryEntries(
    userId: string,
    limit: number,
    query: DiaryListQuery = {},
  ) {
    this.calls.push({ userId, limit, query });
    return this.matchingEntries(query).slice(0, limit);
  }
  async countDiaryEntries(
    _userId: string,
    query: DiaryListQuery = {},
  ) {
    return this.matchingEntries(query).length;
  }
  async countArchivedDiaries() { return 0; }
  async findDiaryById() { return null; }
  async listActiveContentDates() { return []; }
  async findActiveByDate() { return []; }
  async createDiaryWithAudit(): Promise<never> { throw new Error("unused"); }
  async updateDiary() { return null; }
}

test("diary list without parameters preserves authenticated ownership and default limit", async () => {
  const repository = new SearchRepository();
  const result = await new DiaryService(repository).listDiaries({
    userId: "user-1",
  });
  assert.equal(result.metadata.count, 3);
  assert.deepEqual(repository.calls[0], {
    userId: "user-1",
    limit: 50,
    query: {},
  });
});


test("Diary metadata count is independent of the returned row limit", async () => {
  const repository = new SearchRepository();
  const result = await new DiaryService(repository).listDiaries({
    userId: "user-1",
    limit: 1,
  });

  assert.equal(result.diaries.length, 1);
  assert.equal(result.metadata.count, 3);
});

test("diary author filters exact active entries and keeps count consistent", async () => {
  const service = new DiaryService(new SearchRepository());
  for (const [author, expectedId] of [
    ["L", "d1"],
    ["G", "d2"],
    ["C", "d3"],
  ] as const) {
    const result = await service.listDiaries({
      userId: "user-1",
      query: { author },
    });
    assert.deepEqual(result.diaries.map((entry) => entry.id), [expectedId]);
    assert.equal(result.metadata.count, 1);
  }

  const repository = new SearchRepository();
  const trimmed = await new DiaryService(repository).listDiaries({
    userId: "user-1",
    query: { author: " G " },
  });
  assert.deepEqual(trimmed.diaries.map((entry) => entry.id), ["d2"]);
  assert.deepEqual(repository.calls[0]?.query, { author: "G" });
});

test("diary q searches normalized title and content case-insensitively", async () => {
  const repository = new SearchRepository();
  const service = new DiaryService(repository);
  assert.deepEqual(
    (await service.listDiaries({
      userId: "user-1",
      query: { q: "  japan  " },
    })).diaries.map((entry) => entry.id),
    ["d1"],
  );
  assert.deepEqual(
    (await service.listDiaries({
      userId: "user-1",
      query: { q: "旅行" },
    })).diaries.map((entry) => entry.id),
    ["d2"],
  );
});

test("diary tag is an exact complete element and mood is exact", async () => {
  const service = new DiaryService(new SearchRepository());
  assert.deepEqual(
    (await service.listDiaries({
      userId: "user-1",
      query: { tag: "filter-test", mood: "happy" },
    })).diaries.map((entry) => entry.id),
    ["d1"],
  );
  assert.equal((await service.listDiaries({
    userId: "user-1",
    query: { tag: "test" },
  })).metadata.count, 0);
  assert.equal((await service.listDiaries({
    userId: "user-1",
    query: { tag: "filter" },
  })).diaries[0]?.id, "d2");
});

test("diary date filters include both selected boundaries and allow one side", async () => {
  const service = new DiaryService(new SearchRepository());
  assert.deepEqual(
    (await service.listDiaries({
      userId: "user-1",
      query: { dateFrom: "2026-07-01", dateTo: "2026-07-07" },
    })).diaries.map((entry) => entry.id),
    ["d1", "d2"],
  );
  assert.deepEqual(
    (await service.listDiaries({
      userId: "user-1",
      query: { dateFrom: "2026-07-07" },
    })).diaries.map((entry) => entry.id),
    ["d1"],
  );
  assert.deepEqual(
    (await service.listDiaries({
      userId: "user-1",
      query: { dateTo: "2026-07-01" },
    })).diaries.map((entry) => entry.id),
    ["d2", "d3"],
  );
});

test("diary date normalization preserves month-end and year-end calendar dates", async () => {
  const repository = new SearchRepository();
  await new DiaryService(repository).listDiaries({
    userId: "user-1",
    query: {
      dateFrom: "2026-12-31",
      dateTo: "2027-01-01",
    },
  });
  assert.deepEqual(repository.calls[0]?.query, {
    dateFrom: "2026-12-31",
    dateTo: "2027-01-01",
  });
});

test("diary filters combine with AND and are passed before repository limit", async () => {
  const repository = new SearchRepository();
  const result = await new DiaryService(repository).listDiaries({
    userId: "owner",
    limit: 1,
    query: {
      q: "Japan",
      tag: "日本",
      mood: "happy",
      dateFrom: "2026-07-07",
      dateTo: "2026-07-07",
      author: "L",
    },
  });
  assert.deepEqual(result.diaries.map((entry) => entry.id), ["d1"]);
  assert.deepEqual(repository.calls[0], {
    userId: "owner",
    limit: 1,
    query: {
      q: "Japan",
      tag: "日本",
      mood: "happy",
      dateFrom: "2026-07-07",
      dateTo: "2026-07-07",
      author: "L",
    },
  });
});

test("invalid or excessive diary query values are rejected safely", async () => {
  const service = new DiaryService(new SearchRepository());
  for (const query of [
    { q: "x".repeat(201) },
    { tag: "x".repeat(51) },
    { mood: "x".repeat(51) },
    { dateFrom: "2026-02-30" },
    { dateTo: "07/01/2026" },
    { dateFrom: "2026-07-08", dateTo: "2026-07-07" },
    { author: "Claude" },
    { author: "" },
    { author: null as never },
  ]) {
    await assert.rejects(
      service.listDiaries({ userId: "user-1", query }),
      (error: unknown) =>
        error instanceof DiaryDomainError &&
        error.code === "INVALID_DIARY_QUERY",
    );
  }
});

test("diary query and author compose as an AND filter", async () => {
  const result = await new DiaryService(new SearchRepository()).listDiaries({
    userId: "user-1",
    query: { q: "意识", author: "G" },
  });
  assert.deepEqual(result.diaries.map((entry) => entry.id), ["d2"]);
  assert.equal(result.metadata.count, 1);
});
