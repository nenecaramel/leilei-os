import {
  and,
  desc,
  eq,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  diaryComments,
  diaryEntries,
  users,
} from "../../database/schema.js";
import type { ContentAuthor } from "../content-author.js";
import { requireActiveUserInTransaction } from "../require-active-user-transaction.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type DiaryCommentScope = "active" | "archived";

export type DiaryCommentRecord = {
  id: string;
  userId: string;
  diaryId: string;
  author: ContentAuthor;
  content: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
};

export type DiaryCommentCursor = {
  createdAt: Date;
  id: string;
};

export type DiaryCommentCreateInput = {
  userId: string;
  diaryId: string;
  author: ContentAuthor;
  content: string;
  idempotencyKey: string;
  requestHash: string;
};

export type DiaryCommentCreateOutcome =
  | { outcome: "created"; comment: DiaryCommentRecord }
  | { outcome: "replayed"; comment: DiaryCommentRecord }
  | { outcome: "idempotency_conflict" }
  | { outcome: "diary_not_found" }
  | { outcome: "diary_archived" };

export type DiaryCommentMutationOutcome =
  | { outcome: "committed"; comment: DiaryCommentRecord }
  | { outcome: "not_found" }
  | { outcome: "diary_archived" }
  | { outcome: "revision_conflict"; comment: DiaryCommentRecord };

export type DiaryCommentDeleteOutcome =
  | { outcome: "deleted"; commentId: string }
  | { outcome: "not_found" }
  | { outcome: "diary_archived" }
  | { outcome: "revision_conflict"; comment: DiaryCommentRecord };

export interface DiaryCommentRepository {
  findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null>;
  findDiaryStatus(userId: string, diaryId: string): Promise<DiaryCommentScope | null>;
  getComment(input: {
    userId: string;
    id: string;
    scope: DiaryCommentScope;
  }): Promise<DiaryCommentRecord | null>;
  listComments(input: {
    userId: string;
    diaryId: string;
    scope: DiaryCommentScope;
    limit: number;
    before?: DiaryCommentCursor;
  }): Promise<{ comments: DiaryCommentRecord[]; hasMore: boolean }>;
  countComments(input: {
    userId: string;
    diaryId: string;
    scope: DiaryCommentScope;
  }): Promise<number>;
  createCommentIdempotently(
    input: DiaryCommentCreateInput,
  ): Promise<DiaryCommentCreateOutcome>;
  updateComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
    content: string;
  }): Promise<DiaryCommentMutationOutcome>;
  deleteComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
  }): Promise<DiaryCommentDeleteOutcome>;
}

function toRecord(
  row: typeof diaryComments.$inferSelect,
): DiaryCommentRecord {
  return {
    id: row.id,
    userId: row.userId,
    diaryId: row.diaryId,
    author: row.author,
    content: row.content,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleDiaryCommentRepository
  implements DiaryCommentRepository
{
  constructor(private readonly db: Database) {}

  async findUserById(
    userId: string,
  ): Promise<{ status: "active" | "disabled" } | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async findDiaryStatus(
    userId: string,
    diaryId: string,
  ): Promise<DiaryCommentScope | null> {
    const [row] = await this.db
      .select({ status: diaryEntries.status })
      .from(diaryEntries)
      .where(
        and(
          eq(diaryEntries.userId, userId),
          eq(diaryEntries.id, diaryId),
        ),
      )
      .limit(1);
    return row?.status ?? null;
  }

  async getComment(input: {
    userId: string;
    id: string;
    scope: DiaryCommentScope;
  }): Promise<DiaryCommentRecord | null> {
    const [row] = await this.db
      .select({
        id: diaryComments.id,
        userId: diaryComments.userId,
        diaryId: diaryComments.diaryId,
        author: diaryComments.author,
        content: diaryComments.content,
        revision: diaryComments.revision,
        createdAt: diaryComments.createdAt,
        updatedAt: diaryComments.updatedAt,
      })
      .from(diaryComments)
      .innerJoin(
        diaryEntries,
        and(
          eq(diaryComments.userId, diaryEntries.userId),
          eq(diaryComments.diaryId, diaryEntries.id),
        ),
      )
      .where(
        and(
          eq(diaryComments.userId, input.userId),
          eq(diaryComments.id, input.id),
          eq(diaryEntries.status, input.scope),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async listComments(input: {
    userId: string;
    diaryId: string;
    scope: DiaryCommentScope;
    limit: number;
    before?: DiaryCommentCursor;
  }): Promise<{ comments: DiaryCommentRecord[]; hasMore: boolean }> {
    const conditions = [
      eq(diaryComments.userId, input.userId),
      eq(diaryComments.diaryId, input.diaryId),
      eq(diaryEntries.status, input.scope),
    ];

    if (input.before) {
      conditions.push(
        or(
          lt(diaryComments.createdAt, input.before.createdAt),
          and(
            eq(diaryComments.createdAt, input.before.createdAt),
            lt(diaryComments.id, input.before.id),
          ),
        )!,
      );
    }

    const rows = await this.db
      .select({
        id: diaryComments.id,
        userId: diaryComments.userId,
        diaryId: diaryComments.diaryId,
        author: diaryComments.author,
        content: diaryComments.content,
        revision: diaryComments.revision,
        createdAt: diaryComments.createdAt,
        updatedAt: diaryComments.updatedAt,
      })
      .from(diaryComments)
      .innerJoin(
        diaryEntries,
        and(
          eq(diaryComments.userId, diaryEntries.userId),
          eq(diaryComments.diaryId, diaryEntries.id),
        ),
      )
      .where(and(...conditions))
      .orderBy(
        desc(diaryComments.createdAt),
        desc(diaryComments.id),
      )
      .limit(input.limit + 1);

    return {
      comments: rows.slice(0, input.limit),
      hasMore: rows.length > input.limit,
    };
  }

  async countComments(input: {
    userId: string;
    diaryId: string;
    scope: DiaryCommentScope;
  }): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(diaryComments)
      .innerJoin(
        diaryEntries,
        and(
          eq(diaryComments.userId, diaryEntries.userId),
          eq(diaryComments.diaryId, diaryEntries.id),
        ),
      )
      .where(
        and(
          eq(diaryComments.userId, input.userId),
          eq(diaryComments.diaryId, input.diaryId),
          eq(diaryEntries.status, input.scope),
        ),
      );
    return row?.count ?? 0;
  }

  async createCommentIdempotently(
    input: DiaryCommentCreateInput,
  ): Promise<DiaryCommentCreateOutcome> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);

      const [existing] = await transaction
        .select()
        .from(diaryComments)
        .where(
          and(
            eq(diaryComments.userId, input.userId),
            eq(diaryComments.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (existing) {
        return existing.requestHash === input.requestHash
          ? { outcome: "replayed" as const, comment: toRecord(existing) }
          : { outcome: "idempotency_conflict" as const };
      }

      const [diary] = await transaction
        .select({
          id: diaryEntries.id,
          status: diaryEntries.status,
        })
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.userId, input.userId),
            eq(diaryEntries.id, input.diaryId),
          ),
        )
        .for("update")
        .limit(1);

      if (!diary) return { outcome: "diary_not_found" as const };
      if (diary.status !== "active") {
        return { outcome: "diary_archived" as const };
      }

      const [inserted] = await transaction
        .insert(diaryComments)
        .values({
          userId: input.userId,
          diaryId: input.diaryId,
          author: input.author,
          content: input.content,
          revision: 1,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
        })
        .onConflictDoNothing({
          target: [
            diaryComments.userId,
            diaryComments.idempotencyKey,
          ],
        })
        .returning();

      if (inserted) {
        return {
          outcome: "created" as const,
          comment: toRecord(inserted),
        };
      }

      const [replayed] = await transaction
        .select()
        .from(diaryComments)
        .where(
          and(
            eq(diaryComments.userId, input.userId),
            eq(diaryComments.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (!replayed) {
        throw new Error(
          "Idempotent Diary comment was not found after conflict.",
        );
      }

      return replayed.requestHash === input.requestHash
        ? { outcome: "replayed" as const, comment: toRecord(replayed) }
        : { outcome: "idempotency_conflict" as const };
    });
  }

  async updateComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
    content: string;
  }): Promise<DiaryCommentMutationOutcome> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);

      const [identity] = await transaction
        .select({ diaryId: diaryComments.diaryId })
        .from(diaryComments)
        .where(
          and(
            eq(diaryComments.userId, input.userId),
            eq(diaryComments.id, input.id),
          ),
        )
        .limit(1);
      if (!identity) return { outcome: "not_found" as const };

      const [diary] = await transaction
        .select({ status: diaryEntries.status })
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.userId, input.userId),
            eq(diaryEntries.id, identity.diaryId),
          ),
        )
        .for("update")
        .limit(1);
      if (!diary) return { outcome: "not_found" as const };
      if (diary.status !== "active") {
        return { outcome: "diary_archived" as const };
      }

      const [current] = await transaction
        .select()
        .from(diaryComments)
        .where(
          and(
            eq(diaryComments.userId, input.userId),
            eq(diaryComments.id, input.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) return { outcome: "not_found" as const };
      if (current.revision !== input.expectedRevision) {
        return {
          outcome: "revision_conflict" as const,
          comment: toRecord(current),
        };
      }

      const [updated] = await transaction
        .update(diaryComments)
        .set({
          content: input.content,
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(diaryComments.userId, input.userId),
            eq(diaryComments.id, input.id),
            eq(diaryComments.revision, input.expectedRevision),
          ),
        )
        .returning();

      if (!updated) {
        throw new Error("Diary comment update lost its locked row.");
      }
      return {
        outcome: "committed" as const,
        comment: toRecord(updated),
      };
    });
  }

  async deleteComment(input: {
    userId: string;
    id: string;
    expectedRevision: number;
  }): Promise<DiaryCommentDeleteOutcome> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);

      const [identity] = await transaction
        .select({ diaryId: diaryComments.diaryId })
        .from(diaryComments)
        .where(
          and(
            eq(diaryComments.userId, input.userId),
            eq(diaryComments.id, input.id),
          ),
        )
        .limit(1);
      if (!identity) return { outcome: "not_found" as const };

      const [diary] = await transaction
        .select({ status: diaryEntries.status })
        .from(diaryEntries)
        .where(
          and(
            eq(diaryEntries.userId, input.userId),
            eq(diaryEntries.id, identity.diaryId),
          ),
        )
        .for("update")
        .limit(1);
      if (!diary) return { outcome: "not_found" as const };
      if (diary.status !== "active") {
        return { outcome: "diary_archived" as const };
      }

      const [current] = await transaction
        .select()
        .from(diaryComments)
        .where(
          and(
            eq(diaryComments.userId, input.userId),
            eq(diaryComments.id, input.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) return { outcome: "not_found" as const };
      if (current.revision !== input.expectedRevision) {
        return {
          outcome: "revision_conflict" as const,
          comment: toRecord(current),
        };
      }

      const [deleted] = await transaction
        .delete(diaryComments)
        .where(
          and(
            eq(diaryComments.userId, input.userId),
            eq(diaryComments.id, input.id),
            eq(diaryComments.revision, input.expectedRevision),
          ),
        )
        .returning({ id: diaryComments.id });
      if (!deleted) {
        throw new Error("Diary comment delete lost its locked row.");
      }
      return {
        outcome: "deleted" as const,
        commentId: deleted.id,
      };
    });
  }
}
