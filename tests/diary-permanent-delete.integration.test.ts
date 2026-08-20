import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  diaryEntries,
  mcpWriteIdempotency,
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
  "real Diary permanent delete removes exact tool calls and prior lifecycle rows but retains MCP idempotency",
  { skip: !RUN },
  async () => {
    const database = createDatabase(databaseUrl!);
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const userId = randomUUID();
          const otherUserId = randomUUID();
          const diaryId = randomUUID();
          const now = new Date("2026-08-20T00:00:00.000Z");

          await transaction.insert(users).values([
            {
              id: userId,
              email: `diary-delete-${userId}@example.invalid`,
              displayName: "Diary delete owner",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: otherUserId,
              email: `diary-delete-${otherUserId}@example.invalid`,
              displayName: "Diary other owner",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          ]);
          await transaction.insert(diaryEntries).values({
            id: diaryId,
            userId,
            title: "Archived diary",
            content: "must disappear",
            date: "2026-08-20",
            tags: ["private"],
            mood: null,
            source: "web",
            author: "L",
            status: "archived",
            idempotencyKey: `diary-delete-${diaryId}`,
            requestHash: createHash("sha256").update(diaryId).digest("hex"),
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(resourceLifecycleEvents).values([
            {
              userId,
              resourceType: "diary",
              resourceId: diaryId,
              action: "archive",
              actorType: "user",
              channel: "web",
              metadata: { title: "must not survive" },
              createdAt: now,
            },
            {
              userId,
              resourceType: "diary",
              resourceId: diaryId,
              action: "restore",
              actorType: "user",
              channel: "web",
              metadata: {},
              createdAt: now,
            },
          ]);
          await transaction.insert(mcpWriteIdempotency).values({
            userId,
            toolName: "write_diary",
            idempotencyKey: "diary-delete-key-01",
            requestHash: createHash("sha256").update(diaryId).digest("hex"),
            resourceType: "diary_entry",
            resourceId: diaryId,
            createdAt: now,
          });
          await transaction.insert(toolCalls).values([
            {
              userId,
              toolName: "write_diary",
              operation: "create",
              resourceType: "diary_entry",
              resourceId: diaryId,
              idempotencyKey: "diary-delete-key-01",
              requestSummary: { title_length: 1 },
              resultSummary: { id: diaryId },
              durationMs: 1,
              status: "success",
              createdAt: now,
            },
            {
              userId,
              toolName: "write_diary",
              operation: "update",
              resourceType: "memory",
              resourceId: diaryId,
              requestSummary: {},
              resultSummary: {},
              durationMs: 1,
              status: "success",
              createdAt: now,
            },
            {
              userId: otherUserId,
              toolName: "write_diary",
              operation: "create",
              resourceType: "diary_entry",
              resourceId: diaryId,
              requestSummary: {},
              resultSummary: {},
              durationMs: 1,
              status: "success",
              createdAt: now,
            },
          ]);

          const repository = new DrizzleDiaryRepository(transaction as never);
          assert.equal(await repository.permanentlyDeleteDiary!({
            userId,
            id: diaryId,
            actorType: "user",
            channel: "web",
          }), true);
          assert.equal(await repository.permanentlyDeleteDiary!({
            userId,
            id: diaryId,
            actorType: "user",
            channel: "web",
          }), false);

          assert.deepEqual(
            await transaction.select({ id: diaryEntries.id }).from(diaryEntries)
              .where(eq(diaryEntries.id, diaryId)),
            [],
          );
          assert.deepEqual(
            await transaction.select({ resourceId: mcpWriteIdempotency.resourceId })
              .from(mcpWriteIdempotency)
              .where(and(
                eq(mcpWriteIdempotency.userId, userId),
                eq(mcpWriteIdempotency.resourceId, diaryId),
              )),
            [{ resourceId: diaryId }],
          );

          const remainingToolCalls = await transaction.select({
            userId: toolCalls.userId,
            resourceType: toolCalls.resourceType,
            resourceId: toolCalls.resourceId,
          }).from(toolCalls).where(eq(toolCalls.resourceId, diaryId));
          assert.deepEqual(remainingToolCalls, [
            { userId, resourceType: "memory", resourceId: diaryId },
            { userId: otherUserId, resourceType: "diary_entry", resourceId: diaryId },
          ]);

          const events = await transaction.select({
            action: resourceLifecycleEvents.action,
            metadata: resourceLifecycleEvents.metadata,
          }).from(resourceLifecycleEvents).where(and(
            eq(resourceLifecycleEvents.userId, userId),
            eq(resourceLifecycleEvents.resourceType, "diary"),
            eq(resourceLifecycleEvents.resourceId, diaryId),
          ));
          assert.deepEqual(events, [{ action: "permanent_delete", metadata: {} }]);

          throw new RollbackPermanentDeleteTest();
        }),
        RollbackPermanentDeleteTest,
      );
    } finally {
      await database.close();
    }
  },
);
