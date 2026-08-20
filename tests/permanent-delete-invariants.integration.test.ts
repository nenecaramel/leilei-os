import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  coreMemories,
  diaryEntries,
  mcpWriteIdempotency,
  resourceLifecycleEvents,
  tasks,
  users,
} from "../src/database/schema.js";
import { DrizzleExportRepository } from "../src/domains/export/export-repository.js";
import { DrizzleGlobalSearchRepository } from "../src/domains/global-search/global-search-repository.js";
import { DrizzleMemoryRepository } from "../src/domains/memory/memory-repository.js";
import { DrizzleDiaryRepository } from "../src/domains/diary/diary-repository.js";
import { DrizzleTaskRepository } from "../src/domains/task/task-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
const RUN = process.env.RUN_PERMANENT_DELETE_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsedDatabaseUrl?.hostname === "localhost" || parsedDatabaseUrl?.hostname === "127.0.0.1");

class RollbackInvariantTest extends Error {}

test(
  "permanent deletion removes canonical rows from search, export, and direct reads while retaining minimal audit",
  { skip: !RUN },
  async () => {
    const database = createDatabase(databaseUrl!);
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const userId = randomUUID();
          const memoryId = randomUUID();
          const diaryId = randomUUID();
          const taskId = randomUUID();
          const now = new Date("2026-08-20T00:00:00.000Z");
          await transaction.insert(users).values({
            id: userId,
            email: `delete-invariants-${userId}@example.invalid`,
            displayName: "Delete invariant owner",
            status: "active",
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(coreMemories).values({
            id: memoryId,
            userId,
            category: "goal",
            key: `deleted-memory-${memoryId}`,
            content: "deleted memory secret",
            tags: ["deleted"],
            visibility: "assistant",
            source: "web",
            status: "archived",
            author: "L",
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(diaryEntries).values({
            id: diaryId,
            userId,
            title: "Deleted diary title",
            content: "deleted diary secret",
            date: "2026-08-20",
            tags: ["deleted"],
            mood: null,
            source: "web",
            status: "archived",
            author: "L",
            idempotencyKey: `delete-invariant-${diaryId}`,
            requestHash: createHash("sha256").update(diaryId).digest("hex"),
            createdAt: now,
            updatedAt: now,
          });
          await transaction.insert(tasks).values({
            id: taskId,
            userId,
            title: "Deleted task title",
            description: "deleted task secret",
            status: "pending",
            resumeStatus: null,
            lifecycleStatus: "archived",
            author: "L",
            priority: "normal",
            dueTime: null,
            timezone: "Asia/Shanghai",
            tags: [],
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          });
          await transaction.insert(mcpWriteIdempotency).values([
            {
              userId,
              toolName: "write_memory",
              idempotencyKey: "delete-invariant-memory",
              requestHash: "a".repeat(64),
              resourceType: "memory",
              resourceId: memoryId,
              createdAt: now,
            },
            {
              userId,
              toolName: "write_diary",
              idempotencyKey: "delete-invariant-diary",
              requestHash: "b".repeat(64),
              resourceType: "diary_entry",
              resourceId: diaryId,
              createdAt: now,
            },
            {
              userId,
              toolName: "create_task",
              idempotencyKey: "delete-invariant-task",
              requestHash: "c".repeat(64),
              resourceType: "task",
              resourceId: taskId,
              createdAt: now,
            },
          ]);
          const memory = new DrizzleMemoryRepository(transaction as never);
          const diary = new DrizzleDiaryRepository(transaction as never);
          const task = new DrizzleTaskRepository(transaction as never);
          for (const input of [
            { userId, id: memoryId, actorType: "user" as const, channel: "web" as const },
            { userId, id: diaryId, actorType: "user" as const, channel: "web" as const },
            { userId, id: taskId, actorType: "user" as const, channel: "web" as const },
          ]) {
            const deleted = input.id === memoryId
              ? await memory.permanentlyDeleteMemory!(input)
              : input.id === diaryId
                ? await diary.permanentlyDeleteDiary!(input)
                : await task.permanentlyDeleteTask!(input);
            assert.equal(deleted, true);
          }

          assert.equal(await memory.findArchivedAssistantMemoryById({ userId, id: memoryId }), null);
          assert.equal(await diary.findArchivedDiaryById(userId, diaryId), null);
          assert.equal(await task.findArchivedTaskById!(userId, taskId), null);

          const exporter = new DrizzleExportRepository(transaction as never);
          const [memoryExport, diaryExport, taskExport] = await Promise.all([
            exporter.listMemory(userId),
            exporter.listDiary(userId),
            exporter.listTasks(userId),
          ]);
          assert.equal(memoryExport.some((row) => row.id === memoryId), false);
          assert.equal(diaryExport.some((row) => row.id === diaryId), false);
          assert.equal(taskExport.some((row) => row.id === taskId), false);

          const search = new DrizzleGlobalSearchRepository(transaction as never);
          for (const query of ["deleted-memory", "Deleted diary", "Deleted task"]) {
            const results = await search.search({
              userId,
              query,
              modules: ["memory", "diary", "task"],
              scope: "all",
              mode: "normal",
              timezone: "Asia/Shanghai",
              limit: 20,
            });
            assert.equal(results.length, 0);
          }

          const ledger = await transaction.select({ resourceType: mcpWriteIdempotency.resourceType })
            .from(mcpWriteIdempotency).where(eq(mcpWriteIdempotency.userId, userId));
          assert.deepEqual(
            ledger.map((row) => row.resourceType).sort(),
            ["diary_entry", "memory", "task"],
          );
          const events = await transaction.select({
            resourceType: resourceLifecycleEvents.resourceType,
            resourceId: resourceLifecycleEvents.resourceId,
            action: resourceLifecycleEvents.action,
            metadata: resourceLifecycleEvents.metadata,
          }).from(resourceLifecycleEvents).where(eq(resourceLifecycleEvents.userId, userId));
          assert.deepEqual(
            events.map((event) => ({ ...event })).sort((a, b) => a.resourceType.localeCompare(b.resourceType)),
            [
              { resourceType: "diary", resourceId: diaryId, action: "permanent_delete", metadata: {} },
              { resourceType: "memory", resourceId: memoryId, action: "permanent_delete", metadata: {} },
              { resourceType: "task", resourceId: taskId, action: "permanent_delete", metadata: {} },
            ],
          );
          throw new RollbackInvariantTest();
        }),
        RollbackInvariantTest,
      );
    } finally {
      await database.close();
    }
  },
);
