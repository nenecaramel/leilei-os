import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { DiaryDomainError } from "../src/domains/diary/diary-service.js";
import { createListDiariesApiHandler } from "../src/web-api/diary-router.js";

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
