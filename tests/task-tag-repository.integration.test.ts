import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import { tasks, users } from "../src/database/schema.js";
import {
  DrizzleTaskRepository,
} from "../src/domains/task/task-repository.js";
import { TaskService } from "../src/domains/task/task-service.js";

const RUN_INTEGRATION =
  process.env.RUN_DATABASE_INTEGRATION_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

class RollbackTaskTagTest extends Error {}

test(
  "real Task repository keeps tag matching exact across ownership and AND filters",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createDatabase(process.env.DATABASE_URL!);

    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const testUserId = randomUUID();
          const filterTestId = randomUUID();
          const filterId = randomUUID();
          const now = new Date("2026-07-26T06:00:00.000Z");

          await transaction.insert(users).values({
            id: testUserId,
            email: `task-tag-${testUserId}@example.invalid`,
            displayName: "Task tag integration user",
            status: "active",
            createdAt: now,
            updatedAt: now,
          });

          await transaction.insert(tasks).values([
            {
              id: filterTestId,
              userId: testUserId,
              title: "Exact Filter Integration Alpha",
              description: "Repository integration fixture.",
              status: "pending",
              priority: "normal",
              dueTime: now,
              timezone: "UTC",
              tags: ["filter-test", "secondary"],
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            },
            {
              id: filterId,
              userId: testUserId,
              title: "Exact Filter Integration Beta",
              description: "Repository integration fixture.",
              status: "pending",
              priority: "normal",
              dueTime: now,
              timezone: "UTC",
              tags: ["filter"],
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            },
          ]);

          const repository = new DrizzleTaskRepository(
            transaction as never,
          );
          const service = new TaskService(repository);
          const list = async (
            query: Parameters<TaskService["listTasks"]>[0]["query"],
            userId = testUserId,
          ) => (
            await service.listTasks({ userId, query })
          ).tasks;

          const exact = await list({ tag: "filter-test" });
          assert.ok(exact.some((task) => task.id === filterTestId));

          const filter = await list({ tag: "filter" });
          assert.ok(filter.some((task) => task.id === filterId));
          assert.ok(!filter.some((task) => task.id === filterTestId));

          const suffix = await list({ tag: "test" });
          assert.ok(!suffix.some((task) => task.id === filterTestId));

          const caseDifferent = await list({ tag: "FILTER-TEST" });
          assert.ok(!caseDifferent.some((task) => task.id === filterTestId));

          const statusMismatch = await list({
            tag: "filter-test",
            status: "completed",
          });
          assert.ok(!statusMismatch.some((task) => task.id === filterTestId));

          const qMatch = await list({
            tag: "filter-test",
            q: "Alpha",
          });
          assert.ok(qMatch.some((task) => task.id === filterTestId));

          const qMismatch = await list({
            tag: "filter-test",
            q: "Beta",
          });
          assert.ok(!qMismatch.some((task) => task.id === filterTestId));

          const wrongOwner = await repository.findTasks(
            "ffffffff-ffff-4fff-8fff-ffffffffffff",
            100,
            { tag: "filter-test" },
          );
          assert.ok(!wrongOwner.some((task) => task.id === filterTestId));

          const columnTypes = await transaction
            .select({
              columnType: sql<string>`pg_typeof(${tasks.tags})::text`,
            })
            .from(tasks)
            .where(eq(tasks.id, filterTestId));
          assert.equal(
            columnTypes[0]?.columnType,
            "character varying[]",
          );

          throw new RollbackTaskTagTest();
        }),
        RollbackTaskTagTest,
      );
    } finally {
      await database.close();
    }
  },
);
