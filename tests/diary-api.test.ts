import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { DiaryDomainError } from "../src/domains/diary/diary-service.js";
import {
  createArchiveDiaryApiHandler,
  createListArchivedDiariesApiHandler,
  createListDiariesApiHandler,
  createReadArchivedDiaryApiHandler,
  createRestoreDiaryApiHandler,
} from "../src/web-api/diary-router.js";

function responseRecorder() {
  const result: { status?: number; body?: unknown } = {};
  const response = {
    status(status: number) { result.status = status; return response; },
    json(body: unknown) { result.body = body; return response; },
  } as unknown as Response;
  return { result, response };
}

test("diary API forwards separate raw filters with authenticated ownership", async () => {
  const calls: unknown[] = [];
  const handler = createListDiariesApiHandler({
    diaryService: {
      async listDiaries(input) {
        calls.push(input);
        return { diaries: [], metadata: { count: 0 } };
      },
    } as never,
  });
  const { response } = responseRecorder();
  await handler({
    webUserId: "owner",
    query: {
      q: "旅行",
      tag: "日本",
      mood: "happy",
      date_from: "2026-07-01",
      date_to: "2026-07-31",
    },
  } as unknown as Request, response, () => {});
  assert.deepEqual(calls, [{
    userId: "owner",
    query: {
      q: "旅行",
      tag: "日本",
      mood: "happy",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
    },
  }]);
});

test("diary API returns a generic 400 without private query content", async () => {
  const handler = createListDiariesApiHandler({
    diaryService: {
      async listDiaries() {
        throw new DiaryDomainError(
          "INVALID_DIARY_QUERY",
          "Private diary title is invalid.",
        );
      },
    } as never,
  });
  const { result, response } = responseRecorder();
  await handler({
    webUserId: "owner",
    query: { q: "private title" },
  } as unknown as Request, response, () => {});
  assert.equal(result.status, 400);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "INVALID_DIARY_REQUEST",
      message: "The diary request is invalid.",
    },
  });
});

test("Diary archived API uses authenticated ownership and safe success payloads", async () => {
  const calls: unknown[] = [];
  const service = {
    async listArchivedDiaries(input: unknown) {
      calls.push(["list", input]);
      return { diaries: [], metadata: { count: 0 } };
    },
    async readArchivedDiary(input: unknown) {
      calls.push(["detail", input]);
      return { id: "diary-1" };
    },
    async archiveDiary(input: unknown) {
      calls.push(["archive", input]);
    },
    async restoreDiary(input: unknown) {
      calls.push(["restore", input]);
    },
  };
  const request = {
    webUserId: "owner",
    params: { id: "diary-1" },
  } as unknown as Request;

  for (const handler of [
    createListArchivedDiariesApiHandler({ diaryService: service as never }),
    createReadArchivedDiaryApiHandler({ diaryService: service as never }),
    createArchiveDiaryApiHandler({ diaryService: service as never }),
    createRestoreDiaryApiHandler({ diaryService: service as never }),
  ]) {
    const { response } = responseRecorder();
    await handler(request, response, () => {});
  }
  assert.deepEqual(calls, [
    ["list", { userId: "owner" }],
    ["detail", { userId: "owner", id: "diary-1" }],
    ["archive", { userId: "owner", id: "diary-1" }],
    ["restore", { userId: "owner", id: "diary-1" }],
  ]);
});

test("Diary lifecycle API hides inaccessible records behind generic 404", async () => {
  const handler = createArchiveDiaryApiHandler({
    diaryService: {
      async archiveDiary() {
        throw new DiaryDomainError(
          "DIARY_NOT_FOUND",
          "Cross-user private diary exists.",
        );
      },
    } as never,
  });
  const { result, response } = responseRecorder();
  await handler({
    webUserId: "owner",
    params: { id: "secret" },
  } as unknown as Request, response, () => {});
  assert.equal(result.status, 404);
  assert.doesNotMatch(JSON.stringify(result.body), /cross-user|private/i);
});

for (const code of ["USER_NOT_FOUND", "USER_DISABLED"] as const) {
  test(`Diary archived API maps ${code} to the existing unavailable response`, async () => {
    const handler = createListArchivedDiariesApiHandler({
      diaryService: {
        async listArchivedDiaries() {
          throw new DiaryDomainError(code, "private");
        },
      } as never,
    });
    const { result, response } = responseRecorder();
    await handler({
      webUserId: "owner",
    } as unknown as Request, response, () => {});
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, {
      success: false,
      error: {
        code: "DIARY_UNAVAILABLE",
        message: "Diary is unavailable for the authenticated user.",
      },
    });
  });
}
