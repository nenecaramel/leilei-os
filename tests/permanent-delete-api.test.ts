import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { DiaryDomainError } from "../src/domains/diary/diary-service.js";
import { createDiaryPermanentDeleteApiHandler } from "../src/web-api/diary-router.js";

test("Diary permanent delete API authenticates, delegates, and returns empty 204", async () => {
  const calls: unknown[] = [];
  const handler = createDiaryPermanentDeleteApiHandler({
    diaryService: {
      async permanentlyDeleteDiary(input: unknown) { calls.push(input); },
    },
  } as never);
  const result = await invoke(handler, {
    webUserId: "user-a",
    params: { id: "diary-1" },
  });
  assert.deepEqual(calls, [{ userId: "user-a", id: "diary-1" }]);
  assert.equal(result.status, 204);
  assert.equal(result.jsonCalls, 0);
  assert.equal(result.endCalls, 1);
});

test("Permanent delete APIs preserve safe not-found status mapping", async () => {
  const cases = [
    [createDiaryPermanentDeleteApiHandler({ diaryService: { async permanentlyDeleteDiary() { throw new DiaryDomainError("DIARY_NOT_FOUND", "private"); } } } as never), "DIARY_NOT_FOUND"],
  ] as const;
  for (const [handler] of cases) {
    const result = await invoke(handler, { webUserId: "user-a", params: { id: "archived-1" } });
    assert.equal(result.status, 404);
    assert.equal(result.jsonCalls, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /private/);
  }
});

async function invoke(
  handler: (request: Request, response: Response, next: NextFunction) => unknown,
  request: Partial<Request>,
) {
  const result: { status?: number; body?: unknown; jsonCalls: number; endCalls: number } = {
    jsonCalls: 0,
    endCalls: 0,
  };
  const response = {
    status(status: number) { result.status = status; return response; },
    json(body: unknown) { result.jsonCalls += 1; result.body = body; return response; },
    end() { result.endCalls += 1; return response; },
  } as unknown as Response;
  await handler(request as Request, response, (() => {}) as NextFunction);
  return result;
}
