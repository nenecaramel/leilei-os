import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import {
  diaryComments,
  diaryEntries,
  users,
} from "../src/database/schema.js";
import {
  DrizzleDiaryCommentRepository,
} from "../src/domains/diary/diary-comment-repository.js";
import {
  DiaryCommentService,
} from "../src/domains/diary/diary-comment-service.js";

const RUN_INTEGRATION =
  process.env.RUN_DATABASE_INTEGRATION_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

class RollbackDiaryCommentTest extends Error {}

function createLocalDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    prepare: false,
    ssl: false,
  });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

test(
  "real Diary comments preserve Diary canonical state, CAS revisions, lifecycle read-only semantics, and cascade deletion",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createLocalDatabase(process.env.DATABASE_URL!);
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const userId = randomUUID();
          const diaryId = randomUUID();
          const otherUserId = randomUUID();
          const initialDiaryUpdatedAt =
            new Date("2026-09-14T01:00:00.000Z");

          await transaction.insert(users).values([
            {
              id: userId,
              email: `diary-comment-${userId}@example.invalid`,
              displayName: "Diary comment owner",
              status: "active",
            },
            {
              id: otherUserId,
              email: `diary-comment-${otherUserId}@example.invalid`,
              displayName: "Diary comment other",
              status: "active",
            },
          ]);

          await transaction.insert(diaryEntries).values({
            id: diaryId,
            userId,
            title: "Canonical Diary",
            content: "Diary body must remain unchanged.",
            date: "2026-09-14",
            tags: [],
            mood: null,
            source: "chatgpt_mcp",
            author: "L",
            status: "active",
            idempotencyKey: `integration:${diaryId}`,
            requestHash: createHash("sha256")
              .update(diaryId)
              .digest("hex"),
            createdAt: initialDiaryUpdatedAt,
            updatedAt: initialDiaryUpdatedAt,
          });

          const repository = new DrizzleDiaryCommentRepository(
            transaction as never,
          );
          const service = new DiaryCommentService(repository);
          const idempotencyKey =
            `diary-comment-integration-${randomUUID()}`;

          const created = await service.addMcpComment(
            { userId },
            {
              diaryId,
              author: "G",
              content: "First comment",
              idempotencyKey,
            },
          );
          assert.equal(created.metadata.created, true);
          assert.equal(created.comment.revision, 1);
          assert.equal(created.comment.author, "G");

          const replayed = await service.addMcpComment(
            { userId },
            {
              diaryId,
              author: "G",
              content: "First comment",
              idempotencyKey,
            },
          );
          assert.equal(replayed.metadata.idempotent_replay, true);
          assert.equal(replayed.comment.id, created.comment.id);

          const diaryAfterCreate = await transaction
            .select({
              content: diaryEntries.content,
              author: diaryEntries.author,
              updatedAt: diaryEntries.updatedAt,
            })
            .from(diaryEntries)
            .where(eq(diaryEntries.id, diaryId))
            .limit(1);
          assert.deepEqual(diaryAfterCreate[0], {
            content: "Diary body must remain unchanged.",
            author: "L",
            updatedAt: initialDiaryUpdatedAt,
          });

          const noOp = await service.updateComment({
            userId,
            id: created.comment.id,
            expectedRevision: 1,
            content: "First comment",
          });
          assert.equal(noOp.revision, 1);

          const updated = await service.updateComment({
            userId,
            id: created.comment.id,
            expectedRevision: 1,
            content: "Edited comment",
          });
          assert.equal(updated.revision, 2);
          assert.equal(updated.author, "G");
          assert.equal(updated.content, "Edited comment");

          await assert.rejects(
            service.updateComment({
              userId,
              id: created.comment.id,
              expectedRevision: 1,
              content: "stale overwrite",
            }),
            (error: unknown) =>
              error instanceof Error &&
              "code" in error &&
              error.code === "COMMENT_REVISION_CONFLICT",
          );

          const activeList = await service.listComments({
            userId,
            diaryId,
            scope: "active",
          });
          assert.equal(activeList.metadata.count, 1);
          assert.equal(activeList.comments[0]?.id, created.comment.id);

          await transaction
            .update(diaryEntries)
            .set({ status: "archived" })
            .where(
              and(
                eq(diaryEntries.userId, userId),
                eq(diaryEntries.id, diaryId),
              ),
            );

          const archivedList = await service.listComments({
            userId,
            diaryId,
            scope: "archived",
          });
          assert.equal(archivedList.comments[0]?.content, "Edited comment");

          for (const operation of [
            service.updateComment({
              userId,
              id: created.comment.id,
              expectedRevision: 2,
              content: "archived mutation",
            }),
            service.deleteComment({
              userId,
              id: created.comment.id,
              expectedRevision: 2,
            }),
          ]) {
            await assert.rejects(
              operation,
              (error: unknown) =>
                error instanceof Error &&
                "code" in error &&
                error.code === "DIARY_ARCHIVED",
            );
          }

          await assert.rejects(
            service.getComment({
              userId: otherUserId,
              id: created.comment.id,
              scope: "archived",
            }),
            (error: unknown) =>
              error instanceof Error &&
              "code" in error &&
              error.code === "COMMENT_NOT_FOUND",
          );

          const diaryAfterCommentEdit = await transaction
            .select({
              content: diaryEntries.content,
              author: diaryEntries.author,
              updatedAt: diaryEntries.updatedAt,
            })
            .from(diaryEntries)
            .where(eq(diaryEntries.id, diaryId))
            .limit(1);
          assert.deepEqual(diaryAfterCommentEdit[0], {
            content: "Diary body must remain unchanged.",
            author: "L",
            updatedAt: initialDiaryUpdatedAt,
          });

          await transaction
            .delete(diaryEntries)
            .where(
              and(
                eq(diaryEntries.userId, userId),
                eq(diaryEntries.id, diaryId),
              ),
            );

          const remainingComments = await transaction
            .select({ id: diaryComments.id })
            .from(diaryComments)
            .where(
              and(
                eq(diaryComments.userId, userId),
                eq(diaryComments.diaryId, diaryId),
              ),
            );
          assert.deepEqual(remainingComments, []);

          throw new RollbackDiaryCommentTest();
        }),
        RollbackDiaryCommentTest,
      );
    } finally {
      await database.close();
    }
  },
);
