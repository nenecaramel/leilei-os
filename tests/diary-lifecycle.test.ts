import assert from "node:assert/strict";
import test from "node:test";
import type {
  DiaryEntryRecord,
  DiaryLifecycleMutationInput,
  DiaryRepository,
  DiaryUserRecord,
} from "../src/domains/diary/diary-repository.js";
import {
  DiaryDomainError,
  DiaryService,
} from "../src/domains/diary/diary-service.js";

const entry: DiaryEntryRecord = {
  id: "diary-1",
  title: "Lifecycle",
  content: "Complete diary content",
  date: "2026-07-29",
  tags: ["phase-6"],
  mood: "calm",
  createdAt: new Date("2026-07-29T01:00:00.000Z"),
  updatedAt: new Date("2026-07-29T02:00:00.000Z"),
};

class LifecycleRepository implements DiaryRepository {
  user: DiaryUserRecord | null = { status: "active" };
  archived: DiaryEntryRecord[] = [entry];
  archivedCount = 1;
  archivedDetail: DiaryEntryRecord | null = entry;
  archiveResult = true;
  restoreResult = true;
  queries = 0;
  mutations: DiaryLifecycleMutationInput[] = [];

  async findUserById(): Promise<DiaryUserRecord | null> {
    return this.user;
  }
  async findDiaryEntries() { return []; }
  async countDiaryEntries() { return 0; }
  async findDiaryById() { return null; }
  async createDiaryWithAudit(): Promise<never> {
    throw new Error("not used");
  }
  async updateDiary() { return null; }
  async findArchivedDiaries() {
    this.queries += 1;
    return this.archived;
  }
  async countArchivedDiaries() {
    return this.archivedCount;
  }
  async findArchivedDiaryById() {
    this.queries += 1;
    return this.archivedDetail;
  }
  async archiveDiary(input: DiaryLifecycleMutationInput) {
    this.mutations.push(input);
    return this.archiveResult;
  }
  async restoreDiary(input: DiaryLifecycleMutationInput) {
    this.mutations.push(input);
    return this.restoreResult;
  }
}

test("Diary archived list and detail validate the active user and return full content", async () => {
  const repository = new LifecycleRepository();
  const service = new DiaryService(repository);
  const list = await service.listArchivedDiaries({ userId: " user-a " });
  const detail = await service.readArchivedDiary({
    userId: " user-a ",
    id: " diary-1 ",
  });

  assert.equal(list.metadata.count, 1);
  assert.equal(detail.content, entry.content);
  assert.equal(repository.queries, 2);
});

test("Diary archived metadata uses the repository true count", async () => {
  const repository = new LifecycleRepository();
  repository.archivedCount = 7;
  const result = await new DiaryService(repository).listArchivedDiaries({
    userId: "user-a",
    limit: 1,
  });

  assert.equal(result.diaries.length, 1);
  assert.equal(result.metadata.count, 7);
});

for (const state of ["missing", "disabled"] as const) {
  test(`Diary archived reads reject ${state} users before querying records`, async () => {
    const repository = new LifecycleRepository();
    repository.user = state === "missing" ? null : { status: "disabled" };
    const service = new DiaryService(repository);

    await assert.rejects(
      service.listArchivedDiaries({ userId: "user-a" }),
      (error: unknown) =>
        error instanceof DiaryDomainError &&
        error.code === (state === "missing"
          ? "USER_NOT_FOUND"
          : "USER_DISABLED"),
    );
    assert.equal(repository.queries, 0);
  });
}

test("Diary archive and restore use server-owned lifecycle attribution", async () => {
  const repository = new LifecycleRepository();
  const service = new DiaryService(repository);

  await service.archiveDiary({ userId: " user-a ", id: " diary-1 " });
  await service.restoreDiary({ userId: " user-a ", id: " diary-1 " });

  assert.deepEqual(repository.mutations, [
    {
      userId: "user-a",
      id: "diary-1",
      actorType: "user",
      channel: "web",
    },
    {
      userId: "user-a",
      id: "diary-1",
      actorType: "user",
      channel: "web",
    },
  ]);
});

for (const action of ["archive", "restore"] as const) {
  test(`Diary repeated or ineligible ${action} returns DIARY_NOT_FOUND`, async () => {
    const repository = new LifecycleRepository();
    if (action === "archive") repository.archiveResult = false;
    else repository.restoreResult = false;
    const service = new DiaryService(repository);

    await assert.rejects(
      action === "archive"
        ? service.archiveDiary({ userId: "user-a", id: "diary-1" })
        : service.restoreDiary({ userId: "user-a", id: "diary-1" }),
      (error: unknown) =>
        error instanceof DiaryDomainError &&
        error.code === "DIARY_NOT_FOUND",
    );
  });
}

test("Diary lifecycle mutations do not run after user rejection", async () => {
  const repository = new LifecycleRepository();
  repository.user = { status: "disabled" };
  const service = new DiaryService(repository);
  await assert.rejects(
    service.archiveDiary({ userId: "user-a", id: "diary-1" }),
    (error: unknown) =>
      error instanceof DiaryDomainError &&
      error.code === "USER_DISABLED",
  );
  assert.equal(repository.mutations.length, 0);
});
