import assert from "node:assert/strict";
import test from "node:test";
import {
  DiaryCommentDomainError,
  DiaryCommentService,
} from "../src/domains/diary/diary-comment-service.js";
import type {
  DiaryCommentCreateInput,
  DiaryCommentCreateOutcome,
  DiaryCommentDeleteOutcome,
  DiaryCommentMutationOutcome,
  DiaryCommentRecord,
  DiaryCommentRepository,
  DiaryCommentScope,
} from "../src/domains/diary/diary-comment-repository.js";

const USER_ID = "00000000-0000-4000-8000-000000000101";
const DIARY_ID = "00000000-0000-4000-8000-000000000201";
const COMMENT_ID = "00000000-0000-4000-8000-000000000301";

const baseComment = (overrides: Partial<DiaryCommentRecord> = {}): DiaryCommentRecord => ({
  id: COMMENT_ID,
  userId: USER_ID,
  diaryId: DIARY_ID,
  author: "G",
  content: "comment",
  revision: 1,
  createdAt: new Date("2026-09-14T01:00:00.000Z"),
  updatedAt: new Date("2026-09-14T01:00:00.000Z"),
  ...overrides,
});

class FakeRepository implements DiaryCommentRepository {
  userStatus: "active" | "disabled" | null = "active";
  diaryStatus: DiaryCommentScope | null = "active";
  createInput?: DiaryCommentCreateInput;
  createOptions?: { mcpWriteIdempotency?: boolean };
  createOutcome: DiaryCommentCreateOutcome = {
    outcome: "created",
    comment: baseComment(),
  };
  listRows: DiaryCommentRecord[] = [];
  listHasMore = false;
  count = 0;
  updateOutcome: DiaryCommentMutationOutcome = {
    outcome: "committed",
    comment: baseComment({ revision: 2 }),
  };
  deleteOutcome: DiaryCommentDeleteOutcome = {
    outcome: "deleted",
    commentId: COMMENT_ID,
  };

  async findUserById() {
    return this.userStatus === null
      ? null
      : { status: this.userStatus };
  }

  async findDiaryStatus() {
    return this.diaryStatus;
  }

  async getComment() {
    return baseComment();
  }

  async listComments() {
    return {
      comments: this.listRows,
      hasMore: this.listHasMore,
    };
  }

  async countComments() {
    return this.count;
  }

  async createCommentIdempotently(
    input: DiaryCommentCreateInput,
    options?: { mcpWriteIdempotency?: boolean },
  ) {
    this.createInput = input;
    this.createOptions = options;
    return this.createOutcome;
  }

  async updateComment() {
    return this.updateOutcome;
  }

  async deleteComment() {
    return this.deleteOutcome;
  }
}

test("Diary comment create normalizes content and preserves immutable author provenance", async () => {
  const repository = new FakeRepository();
  repository.createOutcome = {
    outcome: "created",
    comment: baseComment({
      author: "C",
      content: "é",
    }),
  };
  const service = new DiaryCommentService(repository);

  const result = await service.addMcpComment(
    { userId: USER_ID },
    {
      diaryId: DIARY_ID,
      author: "C",
      content: "  e\u0301  ",
      idempotencyKey: "diary-comment-create-0001",
    },
  );

  assert.equal(repository.createInput?.content, "é");
  assert.equal(repository.createInput?.author, "C");
  assert.equal(repository.createInput?.diaryId, DIARY_ID);
  assert.match(repository.createInput?.requestHash ?? "", /^[0-9a-f]{64}$/);
  assert.match(repository.createInput?.mcpRequestHash ?? "", /^[0-9a-f]{64}$/);
  assert.notEqual(
    repository.createInput?.requestHash,
    repository.createInput?.mcpRequestHash,
    "MCP fingerprint uses the shared versioned canonical hash",
  );
  assert.deepEqual(repository.createOptions, {
    mcpWriteIdempotency: true,
  });
  assert.deepEqual(result.metadata, {
    created: true,
    idempotent_replay: false,
  });
  assert.equal(result.comment.author, "C");
});

test("Diary Web comment creation keeps local idempotency without claiming an MCP ledger write", async () => {
  const repository = new FakeRepository();
  const service = new DiaryCommentService(repository);

  await service.addWebComment({
    userId: USER_ID,
    diaryId: DIARY_ID,
    author: "L",
    content: "web comment",
    idempotencyKey: "diary-comment-web-0001",
  });

  assert.deepEqual(repository.createOptions, {});
  assert.equal(repository.createInput?.author, "L");
});

test("Diary comment create reports idempotent replay without duplicating", async () => {
  const repository = new FakeRepository();
  repository.createOutcome = {
    outcome: "replayed",
    comment: baseComment(),
  };
  const service = new DiaryCommentService(repository);
  const result = await service.addMcpComment(
    { userId: USER_ID },
    {
      diaryId: DIARY_ID,
      author: "G",
      content: "comment",
      idempotencyKey: "diary-comment-replay-0001",
    },
  );
  assert.deepEqual(result.metadata, {
    created: false,
    idempotent_replay: true,
  });
});

test("Diary comment list returns a chronological page and an opaque cursor for older comments", async () => {
  const repository = new FakeRepository();
  repository.count = 3;
  repository.listHasMore = true;
  repository.listRows = [
    baseComment({
      id: "00000000-0000-4000-8000-000000000303",
      content: "newer",
      createdAt: new Date("2026-09-14T03:00:00.000Z"),
    }),
    baseComment({
      id: "00000000-0000-4000-8000-000000000302",
      content: "older",
      createdAt: new Date("2026-09-14T02:00:00.000Z"),
    }),
  ];
  const service = new DiaryCommentService(repository);

  const result = await service.listComments({
    userId: USER_ID,
    diaryId: DIARY_ID,
    limit: 2,
  });

  assert.deepEqual(
    result.comments.map((comment) => comment.content),
    ["older", "newer"],
  );
  assert.equal(result.metadata.count, 3);
  assert.equal(result.metadata.returned, 2);
  assert.equal(result.metadata.has_more, true);
  assert.ok(result.metadata.next_before);
});

test("Diary comment update exposes the authoritative record on revision conflict", async () => {
  const repository = new FakeRepository();
  repository.updateOutcome = {
    outcome: "revision_conflict",
    comment: baseComment({
      content: "canonical",
      revision: 4,
    }),
  };
  const service = new DiaryCommentService(repository);

  await assert.rejects(
    service.updateComment({
      userId: USER_ID,
      id: COMMENT_ID,
      expectedRevision: 3,
      content: "draft",
    }),
    (error: unknown) => {
      assert.ok(error instanceof DiaryCommentDomainError);
      assert.equal(error.code, "COMMENT_REVISION_CONFLICT");
      assert.equal(error.current?.content, "canonical");
      assert.equal(error.current?.revision, 4);
      return true;
    },
  );
});

test("Diary comment no-op update returns canonical state without advancing revision", async () => {
  const repository = new FakeRepository();
  repository.updateOutcome = {
    outcome: "unchanged",
    comment: baseComment({
      content: "same",
      revision: 7,
    }),
  };
  const service = new DiaryCommentService(repository);

  const result = await service.updateComment({
    userId: USER_ID,
    id: COMMENT_ID,
    expectedRevision: 7,
    content: "same",
  });

  assert.equal(result.content, "same");
  assert.equal(result.revision, 7);
});

test("Archived Diary comments are readable but reject update and delete mutations", async () => {
  const repository = new FakeRepository();
  repository.diaryStatus = "archived";
  repository.updateOutcome = { outcome: "diary_archived" };
  repository.deleteOutcome = { outcome: "diary_archived" };
  const service = new DiaryCommentService(repository);

  const listed = await service.listComments({
    userId: USER_ID,
    diaryId: DIARY_ID,
    scope: "archived",
  });
  assert.deepEqual(listed.comments, []);

  for (const operation of [
    service.updateComment({
      userId: USER_ID,
      id: COMMENT_ID,
      expectedRevision: 1,
      content: "new",
    }),
    service.deleteComment({
      userId: USER_ID,
      id: COMMENT_ID,
      expectedRevision: 1,
    }),
  ]) {
    await assert.rejects(
      operation,
      (error: unknown) =>
        error instanceof DiaryCommentDomainError &&
        error.code === "DIARY_ARCHIVED",
    );
  }
});

test("Diary comment validation rejects invalid content and revisions before persistence", async () => {
  const repository = new FakeRepository();
  const service = new DiaryCommentService(repository);

  await assert.rejects(
    service.addMcpComment(
      { userId: USER_ID },
      {
        diaryId: DIARY_ID,
        author: "G",
        content: "   ",
        idempotencyKey: "diary-comment-invalid-0001",
      },
    ),
    (error: unknown) =>
      error instanceof DiaryCommentDomainError &&
      error.code === "INVALID_COMMENT_CONTENT",
  );

  await assert.rejects(
    service.deleteComment({
      userId: USER_ID,
      id: COMMENT_ID,
      expectedRevision: 0,
    }),
    (error: unknown) =>
      error instanceof DiaryCommentDomainError &&
      error.code === "INVALID_COMMENT_REVISION",
  );
});
