import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { tasks, userSettings, users } from "../src/database/schema.js";
import { DrizzleTaskRepository } from "../src/domains/task/task-repository.js";
import { TaskService } from "../src/domains/task/task-service.js";

const target = process.env.TEMP_DATABASE_URL;
const isLocalTarget = (() => {
  if (!target) return false;
  try {
    const hostname = new URL(target).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost";
  } catch {
    return false;
  }
})();
const run = process.env.RUN_TASK_TIME_DATABASE_TEST === "1" && isLocalTarget;

class RollbackTaskTimeTest extends Error {}

test(
  "real Task repository orders nullable due dates last and preserves ownership",
  { skip: !run },
  async () => {
    const client = postgres(target!, { ssl: false, max: 1, prepare: false });
    const database = drizzle(client);

    try {
      await assert.rejects(
        database.transaction(async (transaction) => {
          const ownerId = randomUUID();
          const otherId = randomUUID();
          const datedEarlier = randomUUID();
          const datedLater = randomUUID();
          const undated = randomUUID();
          const sameDueOlder = randomUUID();

          await transaction.insert(users).values([
            { id: ownerId, email: `${ownerId}@example.invalid`, displayName: "Owner" },
            { id: otherId, email: `${otherId}@example.invalid`, displayName: "Other" },
          ]);
          await transaction.insert(userSettings).values({
            userId: ownerId,
            timezone: "Asia/Shanghai",
          });
          await transaction.insert(tasks).values([
            fixture(datedLater, ownerId, "2026-07-24T08:00:00Z", "2026-07-22T10:00:00Z"),
            fixture(undated, ownerId, null, "2026-07-22T11:00:00Z"),
            fixture(datedEarlier, ownerId, "2026-07-23T08:00:00Z", "2026-07-22T12:00:00Z"),
            fixture(sameDueOlder, ownerId, "2026-07-23T08:00:00Z", "2026-07-22T09:00:00Z"),
            fixture(randomUUID(), otherId, "2026-07-22T08:00:00Z", "2026-07-22T08:00:00Z"),
          ]);

          const service = new TaskService(
            new DrizzleTaskRepository(transaction as never),
            () => new Date("2026-07-22T12:00:00Z"),
          );
          const result = await service.listTasks({ userId: ownerId });

          assert.deepEqual(
            result.tasks.map((task) => task.id),
            [datedEarlier, sameDueOlder, datedLater, undated],
          );
          assert.ok(result.tasks.every((task) => task.timezone === "Asia/Shanghai"));
          assert.equal(result.tasks.at(-1)?.due_time, null);
          throw new RollbackTaskTimeTest();
        }),
        RollbackTaskTimeTest,
      );
    } finally {
      await client.end();
    }
  },
);

function fixture(
  id: string,
  userId: string,
  dueTime: string | null,
  createdAt: string,
) {
  return {
    id,
    userId,
    title: `Task ${id}`,
    description: "Repository ordering fixture.",
    status: "pending" as const,
    priority: "normal" as const,
    dueTime: dueTime ? new Date(dueTime) : null,
    timezone: "Asia/Shanghai",
    tags: [],
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    completedAt: null,
  };
}
