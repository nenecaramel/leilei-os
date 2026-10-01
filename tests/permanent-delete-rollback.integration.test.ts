import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import {
  diaryEntries,
  resourceLifecycleEvents,
  toolCalls,
  users,
} from "../src/database/schema.js";
import { DrizzleDiaryRepository } from "../src/domains/diary/diary-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
const RUN = process.env.RUN_PERMANENT_DELETE_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsedDatabaseUrl?.hostname === "localhost" || parsedDatabaseUrl?.hostname === "127.0.0.1");

class RollbackPermanentDeleteTest extends Error {}

test(
  "Diary permanent delete rolls cleanup back when the business delete affects zero rows",
  { skip: !RUN },
  async () => {
    const client = postgres(databaseUrl!, { max: 1, prepare: false, ssl: false });
    const db = drizzle(client, { schema });
    try {
      await assert.rejects(
        db.transaction(async (transaction) => {
          const userId = randomUUID();
          const diaryId = randomUUID();
          const now = new Date("2026-08-20T00:00:00.000Z");
          await transaction.insert(users).values({
            id: userId,
            email: `diary-rollback-${userId}@example.invalid`,
            displayName: "Diary rollback",
            status: "active",
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(diaryEntries).values({
            id: diaryId,
            userId,
            title: "Rollback diary",
            content: "must remain",
            date: "2026-08-20",
            tags: [],
            mood: null,
            source: "chatgpt_mcp",
            author: "L",
            status: "archived",
            idempotencyKey: `diary-rollback-${diaryId}`,
            requestHash: createHash("sha256").update(diaryId).digest("hex"),
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(toolCalls).values({
            userId,
            toolName: "write_diary",
            operation: "create",
            resourceType: "diary_entry",
            resourceId: diaryId,
            idempotencyKey: `diary-rollback-${diaryId}`,
            requestSummary: { title_length: 1 },
            resultSummary: { id: diaryId },
            durationMs: 1,
            status: "success",
            createdAt: now,
          });
          await transaction.insert(resourceLifecycleEvents).values({
            userId,
            resourceType: "diary",
            resourceId: diaryId,
            action: "archive",
            actorType: "user",
            channel: "web",
            metadata: { title: "must remain" },
            createdAt: now,
          });
          await transaction.execute(sql.raw(`
            CREATE OR REPLACE FUNCTION test_block_diary_permanent_delete()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              RETURN NULL;
            END;
            $$
          `));
          await transaction.execute(sql.raw(`
            CREATE TRIGGER test_block_diary_permanent_delete_trigger
            BEFORE DELETE ON diary_entries
            FOR EACH ROW EXECUTE FUNCTION test_block_diary_permanent_delete()
          `));

          const repository = new DrizzleDiaryRepository(transaction as never);
          await assert.rejects(
            repository.permanentlyDeleteDiary!({
              userId,
              id: diaryId,
              actorType: "user",
              channel: "web",
            }),
            /affected an unexpected number of rows/i,
          );
          assert.deepEqual(
            await transaction.select({ id: diaryEntries.id }).from(diaryEntries)
              .where(eq(diaryEntries.id, diaryId)),
            [{ id: diaryId }],
          );
          assert.equal(
            (await transaction.select({ id: toolCalls.id }).from(toolCalls)
              .where(and(eq(toolCalls.userId, userId), eq(toolCalls.resourceId, diaryId)))).length,
            1,
          );
          assert.deepEqual(
            await transaction.select({ action: resourceLifecycleEvents.action })
              .from(resourceLifecycleEvents)
              .where(and(
                eq(resourceLifecycleEvents.userId, userId),
                eq(resourceLifecycleEvents.resourceId, diaryId),
              )),
            [{ action: "archive" }],
          );
          throw new RollbackPermanentDeleteTest();
        }),
        (error: unknown) => error instanceof RollbackPermanentDeleteTest,
      );
    } finally {
      await client.end();
    }
  },
);
