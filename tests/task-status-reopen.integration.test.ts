import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { tasks, users } from "../src/database/schema.js";
import { DrizzleTaskRepository } from "../src/domains/task/task-repository.js";

const RUN_DATABASE_INTEGRATION =
  process.env.RUN_TASK_STATUS_REOPEN_DATABASE_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

class RollbackTaskStatusReopen extends Error {}

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
  "real Task status reopen preserves resume targets, enforces CAS, and rejects inconsistent rows",
  { skip: !RUN_DATABASE_INTEGRATION },
  async () => {
    const database = createLocalDatabase(process.env.DATABASE_URL!);
    const owner = randomUUID();
    const timestamp = new Date("2026-08-05T00:00:00.000Z");
    const taskId = randomUUID();
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          await transaction.insert(users).values({
            id: owner,
            email: `task-reopen-${owner}@example.invalid`,
            displayName: "Task reopen test",
            status: "active",
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          await transaction.insert(tasks).values({
            id: taskId,
            userId: owner,
            title: "Reopen test",
            description: "Disposable integration fixture",
            status: "pending",
            resumeStatus: null,
            lifecycleStatus: "active",
            priority: "normal",
            dueTime: null,
            timezone: "Asia/Shanghai",
            tags: [],
            createdAt: timestamp,
            updatedAt: timestamp,
            completedAt: null,
            author: "G",
          });
          const repository = new DrizzleTaskRepository(transaction as never);

          const cancelled = await repository.updateTaskStatus({
            userId: owner,
            id: taskId,
            status: "cancelled",
            expectedStatus: "pending",
            resumeStatus: "pending",
            completedAt: null,
          });
          assert.equal(cancelled?.resumeStatus, "pending");
          assert.equal(cancelled?.author, "G");

          const reopened = await repository.reopenTask({
            userId: owner,
            id: taskId,
            expectedStatus: "cancelled",
            resumeStatus: "pending",
          });
          assert.equal(reopened?.status, "pending");
          assert.equal(reopened?.resumeStatus, null);
          assert.equal(reopened?.completedAt, null);
          assert.equal(reopened?.author, "G");

          const [first, second] = await Promise.all([
            repository.updateTaskStatus({
              userId: owner,
              id: taskId,
              status: "in_progress",
              expectedStatus: "pending",
              resumeStatus: null,
              completedAt: null,
            }),
            repository.updateTaskStatus({
              userId: owner,
              id: taskId,
              status: "cancelled",
              expectedStatus: "pending",
              resumeStatus: "pending",
              completedAt: null,
            }),
          ]);
          assert.equal(Number(Boolean(first)) + Number(Boolean(second)), 1);

          await assert.rejects(
            transaction.insert(tasks).values({
              id: randomUUID(),
              userId: owner,
              title: "Invalid fixture",
              description: "Should be rejected by the resume constraint",
              status: "completed",
              resumeStatus: null,
              lifecycleStatus: "active",
              priority: "normal",
              dueTime: null,
              timezone: "Asia/Shanghai",
              tags: [],
              createdAt: timestamp,
              updatedAt: timestamp,
              completedAt: timestamp,
            }),
          );
          throw new RollbackTaskStatusReopen();
        }),
        (error: unknown) => error instanceof RollbackTaskStatusReopen,
      );
    } finally {
      await database.close();
    }
  },
);

test("Task reopen migration contains only the expected consistency constraint", { skip: !RUN_DATABASE_INTEGRATION }, async () => {
  const database = createLocalDatabase(process.env.DATABASE_URL!);
  try {
    const rows = await database.db.execute(sql`SELECT conname FROM pg_constraint WHERE conname = 'tasks_resume_status_consistency'`);
    assert.equal(rows.length, 1);
  } finally {
    await database.close();
  }
});
