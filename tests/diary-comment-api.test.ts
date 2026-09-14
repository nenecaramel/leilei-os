import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  DiaryCommentDomainError,
  type DiaryCommentResult,
} from "../src/domains/diary/diary-comment-service.js";
import {
  createAddDiaryCommentApiHandler,
  createDeleteDiaryCommentApiHandler,
  createListArchivedDiaryCommentsApiHandler,
  createListDiaryCommentsApiHandler,
  createReadDiaryApiHandler,
  createUpdateDiaryCommentApiHandler,
} from "../src/web-api/diary-router.js";

const DIARY_ID = "00000000-0000-4000-8000-000000000401";
const COMMENT_ID = "00000000-0000-4000-8000-000000000501";

const COMMENT: DiaryCommentResult = {
  id: COMMENT_ID,
  diary_id: DIARY_ID,
  author: "G",
  content: "canonical comment",
  revision: 3,
  created_at: "2026-09-14T01:00:00.000Z",
  updated_at: "2026-09-14T01:05:00.000Z",
};

function responseRecorder() {
  const result: { status?: number; body?: unknown } = {};
  const response = {
    status(status: number) {
      result.status = status;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  } as unknown as Response;
  return { result, response };
}

test("Diary comment Web add binds authenticated ownership and forwards stable idempotency", async () => {
  const calls: unknown[] = [];
  const handler = createAddDiaryCommentApiHandler({
    diaryService: {} as never,
    diaryCommentService: {
      async addWebComment(input) {
        calls.push(input);
        return {
          comment: COMMENT,
          metadata: {
            created: true,
            idempotent_replay: false,
          },
        };
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "owner",
    params: { id: DIARY_ID },
    body: {
      userId: "attacker",
      author: "C",
      content: "hello",
      idempotency_key: "web-comment-stable-0001",
    },
  } as unknown as Request, response, () => {});

  assert.equal(result.status, 201);
  assert.deepEqual(calls, [{
    userId: "owner",
    diaryId: DIARY_ID,
    author: "C",
    content: "hello",
    idempotencyKey: "web-comment-stable-0001",
  }]);
});

test("Diary comment list selects active or archived parent scope explicitly", async () => {
  const calls: unknown[] = [];
  const service = {
    async listComments(input: unknown) {
      calls.push(input);
      return {
        comments: [COMMENT],
        metadata: {
          count: 1,
          returned: 1,
          has_more: false,
          next_before: null,
        },
      };
    },
  };

  for (const [handler, scope] of [
    [createListDiaryCommentsApiHandler, "active"],
    [createListArchivedDiaryCommentsApiHandler, "archived"],
  ] as const) {
    const { response } = responseRecorder();
    await handler({
      diaryService: {} as never,
      diaryCommentService: service as never,
    })({
      webUserId: "owner",
      params: { id: DIARY_ID },
      query: { limit: "25", before: "cursor" },
    } as unknown as Request, response, () => {});
    assert.deepEqual(calls.at(-1), {
      userId: "owner",
      diaryId: DIARY_ID,
      scope,
      limit: 25,
      before: "cursor",
    });
  }
});

test("Diary detail includes its recent canonical comment window without changing Diary fields", async () => {
  const diary = {
    id: DIARY_ID,
    title: "Today",
    content: "Diary body",
    date: "2026-09-14",
    tags: [],
    mood: null,
    author: "L" as const,
    created_at: "2026-09-14T00:00:00.000Z",
    updated_at: "2026-09-14T00:00:00.000Z",
  };
  const handler = createReadDiaryApiHandler({
    diaryService: {
      async readDiary() {
        return diary;
      },
    } as never,
    diaryCommentService: {
      async listComments() {
        return {
          comments: [COMMENT],
          metadata: {
            count: 73,
            returned: 1,
            has_more: true,
            next_before: "opaque",
          },
        };
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "owner",
    params: { id: DIARY_ID },
  } as unknown as Request, response, () => {});

  assert.deepEqual(result.body, {
    success: true,
    data: {
      ...diary,
      comments: [COMMENT],
      comments_metadata: {
        count: 73,
        returned: 1,
        truncated: true,
      },
    },
  });
});

test("Diary comment update hides a comment attached to another Diary", async () => {
  let updateCalls = 0;
  const handler = createUpdateDiaryCommentApiHandler({
    diaryService: {} as never,
    diaryCommentService: {
      async getComment() {
        return {
          ...COMMENT,
          diary_id: "00000000-0000-4000-8000-000000000499",
        };
      },
      async updateComment() {
        updateCalls += 1;
        return COMMENT;
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "owner",
    params: { id: DIARY_ID, commentId: COMMENT_ID },
    body: {
      expected_revision: 3,
      content: "draft",
    },
  } as unknown as Request, response, () => {});

  assert.equal(result.status, 404);
  assert.equal(updateCalls, 0);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "COMMENT_NOT_FOUND",
      message: "Diary comment was not found.",
    },
  });
});

test("Diary comment revision conflicts return the authoritative canonical comment", async () => {
  const current = {
    ...COMMENT,
    content: "changed elsewhere",
    revision: 4,
  };
  const handler = createUpdateDiaryCommentApiHandler({
    diaryService: {} as never,
    diaryCommentService: {
      async getComment() {
        return COMMENT;
      },
      async updateComment() {
        throw new DiaryCommentDomainError(
          "COMMENT_REVISION_CONFLICT",
          "private detail",
          current,
        );
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "owner",
    params: { id: DIARY_ID, commentId: COMMENT_ID },
    body: {
      expected_revision: 3,
      content: "draft",
    },
  } as unknown as Request, response, () => {});

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "COMMENT_REVISION_CONFLICT",
      message: "Diary comment revision changed.",
      current,
    },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /private detail/);
});

test("Diary comment delete requires the path parent and exact revision", async () => {
  const calls: unknown[] = [];
  const handler = createDeleteDiaryCommentApiHandler({
    diaryService: {} as never,
    diaryCommentService: {
      async getComment() {
        return COMMENT;
      },
      async deleteComment(input) {
        calls.push(input);
        return {
          comment_id: COMMENT_ID,
          deleted: true as const,
        };
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "owner",
    params: { id: DIARY_ID, commentId: COMMENT_ID },
    body: { expected_revision: 3 },
  } as unknown as Request, response, () => {});

  assert.deepEqual(calls, [{
    userId: "owner",
    id: COMMENT_ID,
    expectedRevision: 3,
  }]);
  assert.deepEqual(result.body, {
    success: true,
    data: {
      comment_id: COMMENT_ID,
      deleted: true,
    },
  });
});

test("Diary detail maps comment-domain parent failures instead of leaking a generic server error", async () => {
  const handler = createReadDiaryApiHandler({
    diaryService: {
      async readDiary() {
        return {
          id: DIARY_ID,
          title: "Today",
          content: "Diary body",
          date: "2026-09-14",
          tags: [],
          mood: null,
          author: "L",
          created_at: "2026-09-14T00:00:00.000Z",
          updated_at: "2026-09-14T00:00:00.000Z",
        };
      },
    } as never,
    diaryCommentService: {
      async listComments() {
        throw new DiaryCommentDomainError(
          "DIARY_NOT_FOUND",
          "private parent detail",
        );
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "owner",
    params: { id: DIARY_ID },
  } as unknown as Request, response, () => {});

  assert.equal(result.status, 404);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "DIARY_NOT_FOUND",
      message: "Diary entry was not found.",
    },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /private parent detail/);
});
