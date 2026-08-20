import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import {
  resourceLifecycleEvents,
  tasks,
  users,
} from "../src/database/schema.js";
import { DrizzleTaskRepository } from "../src/domains/task/task-repository.js";

const RUN_INTEGRATION =
  process.env.RUN_DATABASE_INTEGRATION_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

class RollbackTaskLifecycleTest extends Error {}

function createLocalDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, prepare: false, ssl: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

test(
  "real Task repository enforces lifecycle isolation, atomic audit, ordering, and field preservation",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createLocalDatabase(process.env.DATABASE_URL!);
    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const owner = randomUUID();
          const other = randomUUID();
          const timestamp = new Date("2026-07-29T03:00:00.000Z");
          const completedAt = new Date("2026-07-29T02:00:00.000Z");
          await transaction.insert(users).values([
            {
              id: owner,
              email: `task-lifecycle-${owner}@example.invalid`,
              displayName: "Task lifecycle owner",
              status: "active",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            {
              id: other,
              email: `task-lifecycle-${other}@example.invalid`,
              displayName: "Task lifecycle other",
              status: "active",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]);

          const task = (
            id: string,
            userId: string,
            lifecycleStatus: "active" | "archived",
            overrides: Partial<typeof tasks.$inferInsert> = {},
          ): typeof tasks.$inferInsert => ({
            id,
            userId,
            title: `Task ${id}`,
            description: "Lifecycle fixture",
            status: "pending",
            resumeStatus: null,
            lifecycleStatus,
            priority: "normal",
            dueTime: new Date("2026-08-01T00:00:00.000Z"),
            timezone: "Asia/Shanghai",
            tags: [],
            createdAt: timestamp,
            updatedAt: timestamp,
            completedAt: null,
            ...overrides,
            resumeStatus: overrides.resumeStatus ?? (
              overrides.status === "completed"
                ? "in_progress"
                : overrides.status === "cancelled"
                  ? "pending"
                  : null
            ),
          });

          const lifecycleIds = [
            randomUUID(), randomUUID(), randomUUID(), randomUUID(),
          ];
          await transaction.insert(tasks).values([
            task(lifecycleIds[0]!, owner, "active", { status: "pending", author: "L" }),
            task(lifecycleIds[1]!, owner, "active", { status: "in_progress", author: "G" }),
            task(lifecycleIds[2]!, owner, "active", { status: "cancelled" }),
            task(lifecycleIds[3]!, owner, "active", {
              status: "completed",
              completedAt,
            }),
          ]);
          const authorFixtureIds = [randomUUID(), randomUUID(), randomUUID()];
          await transaction.insert(tasks).values([
            task(authorFixtureIds[0]!, owner, "active", { author: "L" }),
            task(authorFixtureIds[1]!, owner, "active", { author: "G" }),
            task(authorFixtureIds[2]!, owner, "active", { author: null }),
          ]);
          assert.deepEqual(
            (await transaction.select({
              id: tasks.id,
              author: tasks.author,
            }).from(tasks).where(inArray(tasks.id, authorFixtureIds)))
              .sort((left, right) => left.id.localeCompare(right.id)),
            authorFixtureIds
              .map((id, index) => ({
                id,
                author: index === 0 ? "L" : index === 1 ? "G" : null,
              }))
              .sort((left, right) => left.id.localeCompare(right.id)),
          );
          const repository = new DrizzleTaskRepository(transaction as never);

          for (const id of lifecycleIds) {
            assert.equal(await repository.archiveTask({
              id, userId: owner, actorType: "user", channel: "web",
            }), true);
            assert.equal(await repository.findTaskById(owner, id), null);
            assert.equal(
              (await repository.findTasks(owner, 100))
                .some((candidate) => candidate.id === id),
              false,
            );
            assert.equal(await repository.updateTask({
              id,
              userId: owner,
              title: "Must not update archived",
              description: "Must not update archived",
              priority: "normal",
              dueTime: null,
              timezone: "Asia/Shanghai",
              tags: [],
            }), null);
            assert.equal(await repository.updateTaskStatus({
              id,
              userId: owner,
              status: "cancelled",
              completedAt: null,
            }), null);
            assert.equal(await repository.archiveTask({
              id, userId: owner, actorType: "user", channel: "web",
            }), false);
            assert.equal(await repository.restoreTask({
              id, userId: owner, actorType: "user", channel: "web",
            }), true);
            assert.equal(await repository.restoreTask({
              id, userId: owner, actorType: "user", channel: "web",
            }), false);
          }

          const roundTrip = await transaction.select({
            id: tasks.id,
            status: tasks.status,
            lifecycleStatus: tasks.lifecycleStatus,
            updatedAt: tasks.updatedAt,
            completedAt: tasks.completedAt,
            author: tasks.author,
          }).from(tasks).where(inArray(tasks.id, lifecycleIds));
          assert.ok(roundTrip.every((row) =>
            row.lifecycleStatus === "active" &&
            row.updatedAt.toISOString() === timestamp.toISOString()
          ));
          assert.equal(
            roundTrip.find((row) => row.status === "completed")
              ?.completedAt?.toISOString(),
            completedAt.toISOString(),
          );
          assert.equal(roundTrip.find((row) => row.id === lifecycleIds[0])?.author, "L");
          assert.equal(roundTrip.find((row) => row.id === lifecycleIds[1])?.author, "G");
          const [beforePartial] = await transaction.select({
            title: tasks.title,
            description: tasks.description,
            priority: tasks.priority,
            dueTime: tasks.dueTime,
            timezone: tasks.timezone,
            tags: tasks.tags,
          }).from(tasks).where(eq(tasks.id, lifecycleIds[0]!));
          assert.ok(beforePartial?.dueTime, "fixture must start with a due time");
          const dueTimeCleared = await repository.updateTask({
            id: lifecycleIds[0]!,
            userId: owner,
            dueTime: null,
          });
          assert.ok(dueTimeCleared);
          assert.equal(dueTimeCleared.dueTime, null);
          assert.deepEqual({
            title: dueTimeCleared.title,
            description: dueTimeCleared.description,
            priority: dueTimeCleared.priority,
            timezone: dueTimeCleared.timezone,
            tags: dueTimeCleared.tags,
          }, {
            title: beforePartial.title,
            description: beforePartial.description,
            priority: beforePartial.priority,
            timezone: beforePartial.timezone,
            tags: beforePartial.tags,
          });
          const partial = await repository.updateTask({
            id: lifecycleIds[0]!,
            userId: owner,
            description: "Content-only task update",
          });
          assert.ok(partial);
          assert.deepEqual({
            title: partial.title,
            description: partial.description,
            priority: partial.priority,
            dueTime: partial.dueTime,
            timezone: partial.timezone,
            tags: partial.tags,
          }, {
            ...beforePartial,
            description: "Content-only task update",
            dueTime: null,
          });
          const cleared = await repository.updateTask({
            id: lifecycleIds[0]!,
            userId: owner,
            tags: [],
          });
          assert.ok(cleared);
          assert.deepEqual(cleared.tags, []);

          const edited = await repository.updateTask({
            id: lifecycleIds[0]!,
            userId: owner,
            title: "Edited title",
            description: "Edited description",
            priority: "high",
            dueTime: null,
            timezone: "Asia/Shanghai",
            tags: ["edited"],
          });
          assert.ok(edited);
          assert.notEqual(
            edited.updatedAt.toISOString(),
            timestamp.toISOString(),
          );
          const transitionCompletedAt =
            new Date("2026-07-29T05:00:00.000Z");
          const transitioned = await repository.updateTaskStatus({
            id: lifecycleIds[1]!,
            userId: owner,
            status: "completed",
            expectedStatus: "in_progress",
            resumeStatus: "in_progress",
            completedAt: transitionCompletedAt,
          });
          assert.equal(transitioned?.status, "completed");
          assert.equal(
            transitioned?.completedAt?.toISOString(),
            transitionCompletedAt.toISOString(),
          );
          assert.notEqual(
            transitioned?.updatedAt.toISOString(),
            timestamp.toISOString(),
          );
          const events = await transaction.select({
            userId: resourceLifecycleEvents.userId,
            resourceType: resourceLifecycleEvents.resourceType,
            resourceId: resourceLifecycleEvents.resourceId,
            action: resourceLifecycleEvents.action,
            actorType: resourceLifecycleEvents.actorType,
            channel: resourceLifecycleEvents.channel,
            metadata: resourceLifecycleEvents.metadata,
          }).from(resourceLifecycleEvents).where(
            inArray(resourceLifecycleEvents.resourceId, lifecycleIds),
          );
          assert.equal(events.length, lifecycleIds.length * 2);
          assert.ok(events.every((event) =>
            event.userId === owner &&
            event.resourceType === "task" &&
            event.actorType === "user" &&
            event.channel === "web" &&
            Object.keys(event.metadata).length === 0
          ));
          for (const id of lifecycleIds) {
            assert.deepEqual(
              events
                .filter((event) => event.resourceId === id)
                .map((event) => event.action),
              ["archive", "restore"],
            );
          }

          const crossActive = randomUUID();
          const crossArchived = randomUUID();
          await transaction.insert(tasks).values([
            task(crossActive, other, "active"),
            task(crossArchived, other, "archived"),
          ]);
          assert.equal(await repository.archiveTask({
            id: crossActive, userId: owner, actorType: "user", channel: "web",
          }), false);
          assert.equal(await repository.restoreTask({
            id: crossArchived, userId: owner, actorType: "user", channel: "web",
          }), false);
          assert.equal((await transaction.select({ id: resourceLifecycleEvents.id })
            .from(resourceLifecycleEvents)
            .where(inArray(resourceLifecycleEvents.resourceId, [crossActive, crossArchived]))).length, 0);

          for (const lifecycleStatus of ["active", "archived"] as const) {
            const rollbackId = randomUUID();
            await transaction.insert(tasks).values(task(
              rollbackId, owner, lifecycleStatus,
            ));
            const failing = new DrizzleTaskRepository(transaction as never, {
              async record() {
                throw new Error("audit unavailable");
              },
            });
            await assert.rejects(
              lifecycleStatus === "active"
                ? failing.archiveTask({
                  id: rollbackId, userId: owner, actorType: "user", channel: "web",
                })
                : failing.restoreTask({
                  id: rollbackId, userId: owner, actorType: "user", channel: "web",
                }),
              /audit unavailable/,
            );
            const [preserved] = await transaction.select({
              lifecycleStatus: tasks.lifecycleStatus,
            }).from(tasks).where(eq(tasks.id, rollbackId));
            assert.equal(preserved?.lifecycleStatus, lifecycleStatus);
            assert.equal((await transaction.select({ id: resourceLifecycleEvents.id })
              .from(resourceLifecycleEvents)
              .where(eq(resourceLifecycleEvents.resourceId, rollbackId))).length, 0);
          }

          const sameDue = new Date("2026-08-03T00:00:00.000Z");
          const orderIds = Array.from(
            { length: 5 },
            () => randomUUID(),
          ).sort();
          await transaction.insert(tasks).values([
            task(orderIds[0]!, owner, "archived", {
              dueTime: new Date("2026-08-02T00:00:00.000Z"),
              updatedAt: new Date("2030-01-01T00:00:00.000Z"),
            }),
            task(orderIds[1]!, owner, "archived", {
              dueTime: sameDue,
              createdAt: new Date("2026-07-30T00:00:00.000Z"),
            }),
            task(orderIds[2]!, owner, "archived", {
              dueTime: sameDue,
              createdAt: new Date("2026-07-30T00:00:00.000Z"),
            }),
            task(orderIds[3]!, owner, "archived", {
              dueTime: sameDue,
              createdAt: new Date("2026-07-29T00:00:00.000Z"),
            }),
            task(orderIds[4]!, owner, "archived", {
              dueTime: null,
              updatedAt: new Date("2010-01-01T00:00:00.000Z"),
            }),
          ]);
          assert.deepEqual(
            (await repository.findArchivedTasks(owner, 100))
              .filter(({ id }) => orderIds.includes(id))
              .map(({ id }) => id),
            orderIds,
          );

          throw new RollbackTaskLifecycleTest();
        }),
        RollbackTaskLifecycleTest,
      );
    } finally {
      await database.close();
    }
  },
);
