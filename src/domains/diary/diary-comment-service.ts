import { createHash, randomUUID } from "node:crypto";
import {
  isContentAuthor,
  type ContentAuthor,
} from "../content-author.js";
import {
  hashMcpWriteRequest,
} from "../mcp-write/mcp-write-idempotency.js";
import {
  type DiaryCommentCursor,
  type DiaryCommentRecord,
  type DiaryCommentRepository,
  type DiaryCommentScope,
} from "./diary-comment-repository.js";

export const DIARY_COMMENT_CONTENT_MAX_CODE_POINTS = 10_000;
const DEFAULT_COMMENT_LIMIT = 50;
const MAX_COMMENT_LIMIT = 100;
const MIN_IDEMPOTENCY_KEY_LENGTH = 16;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DiaryCommentResult = {
  id: string;
  diary_id: string;
  author: ContentAuthor;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

export type AddDiaryCommentResult = {
  comment: DiaryCommentResult;
  metadata: {
    created: boolean;
    idempotent_replay: boolean;
  };
};

export type ListDiaryCommentsResult = {
  comments: DiaryCommentResult[];
  metadata: {
    count: number;
    returned: number;
    has_more: boolean;
    next_before: string | null;
  };
};

export type DiaryCommentDomainErrorCode =
  | "INVALID_AUTHENTICATED_USER"
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "DIARY_NOT_FOUND"
  | "DIARY_ARCHIVED"
  | "COMMENT_NOT_FOUND"
  | "INVALID_DIARY_ID"
  | "INVALID_COMMENT_ID"
  | "INVALID_COMMENT_AUTHOR"
  | "INVALID_COMMENT_CONTENT"
  | "INVALID_COMMENT_LIMIT"
  | "INVALID_COMMENT_CURSOR"
  | "INVALID_COMMENT_REVISION"
  | "COMMENT_REVISION_CONFLICT"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_CONFLICT";

export class DiaryCommentDomainError extends Error {
  constructor(
    readonly code: DiaryCommentDomainErrorCode,
    message: string,
    readonly current?: DiaryCommentResult,
  ) {
    super(message);
    this.name = "DiaryCommentDomainError";
  }
}

export class DiaryCommentService {
  constructor(
    private readonly repository: DiaryCommentRepository,
  ) {}

  async addMcpComment(
    context: { userId: string },
    input: {
      diaryId: string;
      author: ContentAuthor;
      content: string;
      idempotencyKey: string;
    },
  ): Promise<AddDiaryCommentResult> {
    return this.addComment(
      {
        userId: context.userId,
        diaryId: input.diaryId,
        author: input.author,
        content: input.content,
        idempotencyKey: input.idempotencyKey,
      },
      { mcpWriteIdempotency: true },
    );
  }

  async addWebComment(input: {
    userId: string;
    diaryId: string;
    author: ContentAuthor;
    content: string;
    idempotencyKey?: string;
  }): Promise<AddDiaryCommentResult> {
    return this.addComment({
      ...input,
      idempotencyKey:
        input.idempotencyKey ?? `web:${randomUUID()}`,
    });
  }

  async getComment(input: {
    userId: string;
    id: string;
    scope?: DiaryCommentScope;
  }): Promise<DiaryCommentResult> {
    const userId = await this.requireActiveUser(input.userId);
    const id = this.normalizeUuid(
      input.id,
      "INVALID_COMMENT_ID",
      "Diary comment id",
    );
    const scope = input.scope ?? "active";
    const comment = await this.repository.getComment({
      userId,
      id,
      scope,
    });
    if (!comment) {
      throw new DiaryCommentDomainError(
        "COMMENT_NOT_FOUND",
        "Diary comment was not found.",
      );
    }
    return this.toResult(comment);
  }

  async listComments(input: {
    userId: string;
    diaryId: string;
    scope?: DiaryCommentScope;
    limit?: number;
    before?: string;
  }): Promise<ListDiaryCommentsResult> {
    const userId = await this.requireActiveUser(input.userId);
    const diaryId = this.normalizeUuid(
      input.diaryId,
      "INVALID_DIARY_ID",
      "Diary id",
    );
    const scope = input.scope ?? "active";
    const limit = this.resolveLimit(input.limit);
    const before = input.before
      ? this.decodeCursor(input.before)
      : undefined;

    const status = await this.repository.findDiaryStatus(
      userId,
      diaryId,
    );
    if (!status || status !== scope) {
      throw new DiaryCommentDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }

    const [page, count] = await Promise.all([
      this.repository.listComments({
        userId,
        diaryId,
        scope,
        limit,
        before,
      }),
      this.repository.countComments({
        userId,
        diaryId,
        scope,
      }),
    ]);

    const nextBefore =
      page.hasMore && page.comments.length > 0
        ? this.encodeCursor(page.comments[page.comments.length - 1]!)
        : null;

    const comments = [...page.comments]
      .reverse()
      .map((comment) => this.toResult(comment));

    return {
      comments,
      metadata: {
        count,
        returned: comments.length,
        has_more: page.hasMore,
        next_before: nextBefore,
      },
    };
  }

  async updateComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
    content: string;
  }): Promise<DiaryCommentResult> {
    const userId = await this.requireActiveUser(input.userId);
    const id = this.normalizeUuid(
      input.id,
      "INVALID_COMMENT_ID",
      "Diary comment id",
    );
    const expectedRevision = this.normalizeRevision(
      input.expectedRevision,
    );
    const content = this.normalizeContent(input.content);

    const outcome = await this.repository.updateComment({
      userId,
      id,
      expectedRevision,
      content,
    });

    if (
      outcome.outcome === "committed" ||
      outcome.outcome === "unchanged"
    ) {
      return this.toResult(outcome.comment);
    }
    if (outcome.outcome === "not_found") {
      throw new DiaryCommentDomainError(
        "COMMENT_NOT_FOUND",
        "Diary comment was not found.",
      );
    }
    if (outcome.outcome === "diary_archived") {
      throw new DiaryCommentDomainError(
        "DIARY_ARCHIVED",
        "Archived Diary comments are read-only.",
      );
    }
    throw new DiaryCommentDomainError(
      "COMMENT_REVISION_CONFLICT",
      "Diary comment revision changed before the update.",
      this.toResult(outcome.comment),
    );
  }

  async deleteComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
  }): Promise<{ comment_id: string; deleted: true }> {
    const userId = await this.requireActiveUser(input.userId);
    const id = this.normalizeUuid(
      input.id,
      "INVALID_COMMENT_ID",
      "Diary comment id",
    );
    const expectedRevision = this.normalizeRevision(
      input.expectedRevision,
    );

    const outcome = await this.repository.deleteComment({
      userId,
      id,
      expectedRevision,
    });

    if (outcome.outcome === "deleted") {
      return {
        comment_id: outcome.commentId,
        deleted: true,
      };
    }
    if (outcome.outcome === "not_found") {
      throw new DiaryCommentDomainError(
        "COMMENT_NOT_FOUND",
        "Diary comment was not found.",
      );
    }
    if (outcome.outcome === "diary_archived") {
      throw new DiaryCommentDomainError(
        "DIARY_ARCHIVED",
        "Archived Diary comments are read-only.",
      );
    }
    throw new DiaryCommentDomainError(
      "COMMENT_REVISION_CONFLICT",
      "Diary comment revision changed before the delete.",
      this.toResult(outcome.comment),
    );
  }

  private async addComment(
    input: {
      userId: string;
      diaryId: string;
      author: ContentAuthor;
      content: string;
      idempotencyKey: string;
    },
    options: { mcpWriteIdempotency?: boolean } = {},
  ): Promise<AddDiaryCommentResult> {
    const userId = await this.requireActiveUser(input.userId);
    const diaryId = this.normalizeUuid(
      input.diaryId,
      "INVALID_DIARY_ID",
      "Diary id",
    );
    if (!isContentAuthor(input.author)) {
      throw new DiaryCommentDomainError(
        "INVALID_COMMENT_AUTHOR",
        "Diary comment author must be L, G, or C.",
      );
    }
    const content = this.normalizeContent(input.content);
    const idempotencyKey = this.normalizeIdempotencyKey(
      input.idempotencyKey,
    );
    const hashPayload = {
      diary_id: diaryId,
      author: input.author,
      content,
    };
    const requestHash = createHash("sha256")
      .update(JSON.stringify(hashPayload), "utf8")
      .digest("hex");
    const mcpRequestHash = hashMcpWriteRequest(hashPayload);

    const outcome =
      await this.repository.createCommentIdempotently(
        {
          userId,
          diaryId,
          author: input.author,
          content,
          idempotencyKey,
          requestHash,
          mcpRequestHash,
        },
        options,
      );

    if (
      outcome.outcome === "created" ||
      outcome.outcome === "replayed"
    ) {
      return {
        comment: this.toResult(outcome.comment),
        metadata: {
          created: outcome.outcome === "created",
          idempotent_replay: outcome.outcome === "replayed",
        },
      };
    }
    if (outcome.outcome === "diary_not_found") {
      throw new DiaryCommentDomainError(
        "DIARY_NOT_FOUND",
        "Diary entry was not found.",
      );
    }
    if (outcome.outcome === "diary_archived") {
      throw new DiaryCommentDomainError(
        "DIARY_ARCHIVED",
        "Archived Diary comments are read-only.",
      );
    }
    throw new DiaryCommentDomainError(
      "IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used for a different Diary comment.",
    );
  }

  private async requireActiveUser(userId: string): Promise<string> {
    const normalized = userId.trim();
    if (!normalized) {
      throw new DiaryCommentDomainError(
        "INVALID_AUTHENTICATED_USER",
        "Authenticated user is required.",
      );
    }
    const user = await this.repository.findUserById(normalized);
    if (!user) {
      throw new DiaryCommentDomainError(
        "USER_NOT_FOUND",
        "User was not found.",
      );
    }
    if (user.status !== "active") {
      throw new DiaryCommentDomainError(
        "USER_DISABLED",
        "User is disabled.",
      );
    }
    return normalized;
  }

  private normalizeContent(value: unknown): string {
    if (typeof value !== "string") {
      throw new DiaryCommentDomainError(
        "INVALID_COMMENT_CONTENT",
        "Diary comment content must be text.",
      );
    }
    const normalized = value.normalize("NFC").trim();
    const length = Array.from(normalized).length;
    if (
      length === 0 ||
      length > DIARY_COMMENT_CONTENT_MAX_CODE_POINTS
    ) {
      throw new DiaryCommentDomainError(
        "INVALID_COMMENT_CONTENT",
        `Diary comment content must contain between 1 and ${DIARY_COMMENT_CONTENT_MAX_CODE_POINTS} Unicode code points.`,
      );
    }
    return normalized;
  }

  private normalizeIdempotencyKey(value: string): string {
    const normalized = value.trim();
    if (
      normalized.length < MIN_IDEMPOTENCY_KEY_LENGTH ||
      normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
      !IDEMPOTENCY_KEY_PATTERN.test(normalized)
    ) {
      throw new DiaryCommentDomainError(
        "INVALID_IDEMPOTENCY_KEY",
        "Diary comment idempotency key is invalid.",
      );
    }
    return normalized;
  }

  private normalizeRevision(value: number): number {
    if (!Number.isInteger(value) || value < 1) {
      throw new DiaryCommentDomainError(
        "INVALID_COMMENT_REVISION",
        "Diary comment revision must be a positive integer.",
      );
    }
    return value;
  }

  private resolveLimit(value: number | undefined): number {
    if (value === undefined) return DEFAULT_COMMENT_LIMIT;
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_COMMENT_LIMIT
    ) {
      throw new DiaryCommentDomainError(
        "INVALID_COMMENT_LIMIT",
        `Diary comment limit must be between 1 and ${MAX_COMMENT_LIMIT}.`,
      );
    }
    return value;
  }

  private normalizeUuid(
    value: string,
    code: "INVALID_DIARY_ID" | "INVALID_COMMENT_ID",
    label: string,
  ): string {
    const normalized = value.trim();
    if (!UUID_PATTERN.test(normalized)) {
      throw new DiaryCommentDomainError(
        code,
        `${label} must be a UUID.`,
      );
    }
    return normalized;
  }

  private encodeCursor(comment: DiaryCommentRecord): string {
    return Buffer.from(
      JSON.stringify({
        created_at: comment.createdAt.toISOString(),
        id: comment.id,
      }),
      "utf8",
    ).toString("base64url");
  }

  private decodeCursor(value: string): DiaryCommentCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, "base64url").toString("utf8"),
      ) as { created_at?: unknown; id?: unknown };
      if (
        typeof parsed.created_at !== "string" ||
        typeof parsed.id !== "string" ||
        !UUID_PATTERN.test(parsed.id)
      ) {
        throw new Error("invalid cursor shape");
      }
      const createdAt = new Date(parsed.created_at);
      if (Number.isNaN(createdAt.getTime())) {
        throw new Error("invalid cursor date");
      }
      return { createdAt, id: parsed.id };
    } catch {
      throw new DiaryCommentDomainError(
        "INVALID_COMMENT_CURSOR",
        "Diary comment cursor is invalid.",
      );
    }
  }

  private toResult(
    comment: DiaryCommentRecord,
  ): DiaryCommentResult {
    return {
      id: comment.id,
      diary_id: comment.diaryId,
      author: comment.author,
      content: comment.content,
      revision: comment.revision,
      created_at: comment.createdAt.toISOString(),
      updated_at: comment.updatedAt.toISOString(),
    };
  }
}
