import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  mcpWriteIdempotency,
  resourceLifecycleEvents,
  tasks,
  users,
} from "../src/database/schema.js";
import { DrizzleTaskRepository } from "../src/domains/task/task-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = databaseUrl ? new URL(databaseUrl) : null;
const RUN = process.env.RUN_PERMANENT_DELETE_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsedDatabaseUrl?.hostname === "localhost" || parsedDatabaseUrl?.hostname === "127.0.0.1");

class RollbackPermanentDeleteTest extends Error {}

test(
  "real Task permanent delete removes archived content and old lifecycle rows but retains MCP idempotency",
  { skip: !RUN },
  async () => {
    const database = createDatabase(databaseUrl!);
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const userId = randomUUID();
          const otherUserId = randomUUID();
          const taskId = randomUUID();
          const otherTaskId = randomUUID();
          const now = new Date("2026-08-20T00:00:00.000Z");
          await transaction.insert(users).values([
            {
              id: userId,
              email: `task-delete-${userId}@example.invalid`,
              displayName: "Task delete owner",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: otherUserId,
              email: `task-delete-${otherUserId}@example.invalid`,
              displayName: "Task other owner",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          ]);
          const task = (id: string, owner: string) => ({
            id,
            userId: owner,
            title: "Archived task",
            description: "must disappear",
            status: "pending" as const,
            resumeStatus: null,
            lifecycleStatus: "archived" as const,
            author: "L" as const,
            priority: "normal" as const,
            dueTime: null,
            timezone: "Asia/Shanghai",
            tags: [],
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          });
          await transaction.insert(tasks).values([task(taskId, userId), task(otherTaskId, otherUserId)]);
          await transaction.insert(resourceLifecycleEvents).values([
            {
              userId,
              resourceType: "task",
              resourceId: taskId,
              action: "archive",
              actorType: "user",
              channel: "web",
              metadata: { title: "must not survive" },
              createdAt: now,
            },
            {
              userId,
              resourceType: "task",
              resourceId: taskId,
              action: "restore",
              actorType: "user",
              channel: "web",
              metadata: {},
              createdAt: now,
            },
          ]);
          await transaction.insert(mcpWriteIdempotency).values({
            userId,
            toolName: "create_task",
            idempotencyKey: "task-delete-key-01",
            requestHash: createHash("sha256").update(taskId).digest("hex"),
            resourceType: "task",
            resourceId: taskId,
            createdAt: now,
          });

          const repository = new DrizzleTaskRepository(transaction as never);
          assert.equal(await repository.permanentlyDeleteTask!({
            userId,
            id: taskId,
            actorType: "user",
            channel: "web",
          }), true);
          assert.equal(await repository.permanentlyDeleteTask!({
            userId,
            id: taskId,
            actorType: "user",
            channel: "web",
          }), false);

          assert.deepEqual(
            await transaction.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)),
            [],
          );
          assert.deepEqual(
            await transaction.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, otherTaskId)),
            [{ id: otherTaskId }],
          );
          assert.deepEqual(
            await transaction.select({ resourceId: mcpWriteIdempotency.resourceId })
              .from(mcpWriteIdempotency).where(and(
                eq(mcpWriteIdempotency.userId, userId),
                eq(mcpWriteIdempotency.resourceId, taskId),
              )),
            [{ resourceId: taskId }],
          );
          const events = await transaction.select({
            action: resourceLifecycleEvents.action,
            metadata: resourceLifecycleEvents.metadata,
          }).from(resourceLifecycleEvents).where(and(
            eq(resourceLifecycleEvents.userId, userId),
            eq(resourceLifecycleEvents.resourceType, "task"),
            eq(resourceLifecycleEvents.resourceId, taskId),
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
