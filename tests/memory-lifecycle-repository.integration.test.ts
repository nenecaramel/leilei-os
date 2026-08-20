import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import {
  coreMemories,
  resourceLifecycleEvents,
  users,
} from "../src/database/schema.js";
import {
  DrizzleMemoryRepository,
} from "../src/domains/memory/memory-repository.js";

const RUN_INTEGRATION =
  process.env.RUN_DATABASE_INTEGRATION_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

class RollbackMemoryLifecycleTest extends Error {}

function createLocalDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10, prepare: false, ssl: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

test(
  "real Memory repository updates and archives only owned active assistant-visible rows",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createLocalDatabase(process.env.DATABASE_URL!);

    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const ownerId = randomUUID();
          const otherUserId = randomUUID();
          const archiveListUserId = randomUUID();
          const lifecycleOrderUserId = randomUUID();
          const now = new Date("2026-07-29T00:00:00.000Z");
          const contentTimestamp =
            new Date("2026-07-20T00:00:00.000Z");

          await transaction.insert(users).values([
            {
              id: ownerId,
              email: `memory-lifecycle-${ownerId}@example.invalid`,
              displayName: "Memory lifecycle owner",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: otherUserId,
              email: `memory-lifecycle-${otherUserId}@example.invalid`,
              displayName: "Memory lifecycle other",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: archiveListUserId,
              email: `memory-archive-list-${archiveListUserId}@example.invalid`,
              displayName: "Memory archive list owner",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: lifecycleOrderUserId,
              email: `memory-lifecycle-order-${lifecycleOrderUserId}@example.invalid`,
              displayName: "Memory lifecycle ordering owner",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          ]);

          const fixtures = [
            {
              name: "eligible",
              userId: ownerId,
              status: "active",
              visibility: "assistant",
            },
            {
              name: "cross-user",
              userId: otherUserId,
              status: "active",
              visibility: "assistant",
            },
            {
              name: "archived",
              userId: ownerId,
              status: "archived",
              visibility: "assistant",
            },
            {
              name: "private",
              userId: ownerId,
              status: "active",
              visibility: "private",
            },
            {
              name: "restricted",
              userId: ownerId,
              status: "active",
              visibility: "restricted",
            },
          ] as const;
          const updateIds = new Map<string, string>();
          const archiveIds = new Map<string, string>();

          for (const fixture of fixtures) {
            const updateId = randomUUID();
            const archiveId = randomUUID();
            updateIds.set(fixture.name, updateId);
            archiveIds.set(fixture.name, archiveId);
            await transaction.insert(coreMemories).values([
              {
                id: updateId,
                userId: fixture.userId,
                category: "goal",
                key: `update_${fixture.name}_${updateId}`,
                content: "Original update fixture",
                tags: [],
                visibility: fixture.visibility,
                source: "integration",
                status: fixture.status,
                createdAt: contentTimestamp,
                updatedAt: contentTimestamp,
              },
              {
                id: archiveId,
                userId: fixture.userId,
                category: "goal",
                key: `archive_${fixture.name}_${archiveId}`,
                content: "Original archive fixture",
                tags: [],
                visibility: fixture.visibility,
                source: "integration",
                status: fixture.status,
                createdAt: contentTimestamp,
                updatedAt: contentTimestamp,
              },
            ]);
          }

          const authorFixtureIds = [randomUUID(), randomUUID(), randomUUID()];
          await transaction.insert(coreMemories).values([
            {
              id: authorFixtureIds[0]!,
              userId: ownerId,
              category: "goal",
              key: "author_l_memory",
              content: "Explicit L author fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "active",
              author: "L",
            },
            {
              id: authorFixtureIds[1]!,
              userId: ownerId,
              category: "goal",
              key: "author_g_memory",
              content: "Explicit G author fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "active",
              author: "G",
            },
            {
              id: authorFixtureIds[2]!,
              userId: ownerId,
              category: "goal",
              key: "author_null_memory",
              content: "Legacy null author fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "active",
              author: null,
            },
          ]);
          assert.deepEqual(
            (await transaction.select({
              id: coreMemories.id,
              author: coreMemories.author,
            }).from(coreMemories).where(inArray(coreMemories.id, authorFixtureIds)))
              .sort((left, right) => left.id.localeCompare(right.id)),
            authorFixtureIds
              .map((id, index) => ({
                id,
                author: index === 0 ? "L" : index === 1 ? "G" : null,
              }))
              .sort((left, right) => left.id.localeCompare(right.id)),
          );

          const archivedOlder =
            "00000000-0000-4000-8000-000000000201";
          const archivedTieLow =
            "00000000-0000-4000-8000-000000000202";
          const archivedTieHigh =
            "00000000-0000-4000-8000-000000000203";
          await transaction.insert(coreMemories).values([
            {
              id: archivedOlder,
              userId: archiveListUserId,
              category: "goal",
              key: "archived_older",
              content: "Older archived fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "archived",
              updatedAt: new Date("2026-07-29T01:00:00.000Z"),
            },
            {
              id: archivedTieLow,
              userId: archiveListUserId,
              category: "goal",
              key: "archived_tie_low",
              content: "Archived tie fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "archived",
              updatedAt: new Date("2026-07-29T02:00:00.000Z"),
            },
            {
              id: archivedTieHigh,
              userId: archiveListUserId,
              category: "goal",
              key: "archived_tie_high",
              content: "Archived tie fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "archived",
              updatedAt: new Date("2026-07-29T02:00:00.000Z"),
            },
            {
              userId: archiveListUserId,
              category: "goal",
              key: "active_excluded",
              content: "Active fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "active",
            },
            {
              userId: archiveListUserId,
              category: "goal",
              key: "private_excluded",
              content: "Private archived fixture",
              tags: [],
              visibility: "private",
              source: "integration",
              status: "archived",
            },
            {
              userId: archiveListUserId,
              category: "goal",
              key: "restricted_excluded",
              content: "Restricted archived fixture",
              tags: [],
              visibility: "restricted",
              source: "integration",
              status: "archived",
            },
            {
              userId: otherUserId,
              category: "goal",
              key: "other_archived_excluded",
              content: "Other archived fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "archived",
            },
          ]);

          const repository = new DrizzleMemoryRepository(
            transaction as never,
          );

          const newerContentId =
            "00000000-0000-4000-8000-000000000301";
          const olderContentId =
            "00000000-0000-4000-8000-000000000302";
          const newerContentUpdatedAt =
            new Date("2026-07-29T00:00:00.000Z");
          const olderContentUpdatedAt =
            new Date("2026-07-24T00:00:00.000Z");
          await transaction.insert(coreMemories).values([
            {
              id: newerContentId,
              userId: lifecycleOrderUserId,
              category: "goal",
              key: "newer_content_memory",
              content: "Newer content timestamp",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "active",
              updatedAt: newerContentUpdatedAt,
            },
            {
              id: olderContentId,
              userId: lifecycleOrderUserId,
              category: "goal",
              key: "older_content_memory",
              content: "Older content timestamp",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "active",
              updatedAt: olderContentUpdatedAt,
            },
          ]);
          assert.equal(await repository.archiveMemory({
            id: newerContentId,
            userId: lifecycleOrderUserId,
            actorType: "user",
            channel: "web",
          }), true);
          assert.equal(await repository.archiveMemory({
            id: olderContentId,
            userId: lifecycleOrderUserId,
            actorType: "user",
            channel: "web",
          }), true);
          assert.deepEqual(
            (await repository.findArchivedAssistantMemories({
              userId: lifecycleOrderUserId,
              limit: 10,
            })).map(({ id }) => id),
            [newerContentId, olderContentId],
            "later archive action cannot override content updated_at ordering",
          );
          assert.equal(await repository.restoreMemory({
            id: newerContentId,
            userId: lifecycleOrderUserId,
            actorType: "user",
            channel: "web",
          }), true);
          assert.equal(await repository.restoreMemory({
            id: olderContentId,
            userId: lifecycleOrderUserId,
            actorType: "user",
            channel: "web",
          }), true);
          const lifecycleOrderRows = await transaction
            .select({
              id: coreMemories.id,
              status: coreMemories.status,
              updatedAt: coreMemories.updatedAt,
            })
            .from(coreMemories)
            .where(eq(coreMemories.userId, lifecycleOrderUserId));
          assert.deepEqual(
            new Map(
              lifecycleOrderRows.map((row) => [
                row.id,
                {
                  status: row.status,
                  updatedAt: row.updatedAt.toISOString(),
                },
              ]),
            ),
            new Map([
              [
                newerContentId,
                {
                  status: "active",
                  updatedAt: newerContentUpdatedAt.toISOString(),
                },
              ],
              [
                olderContentId,
                {
                  status: "active",
                  updatedAt: olderContentUpdatedAt.toISOString(),
                },
              ],
            ]),
            "active -> archive -> restore preserves Memory updated_at",
          );
          const lifecycleOrderEvents = await transaction
            .select({
              resourceId: resourceLifecycleEvents.resourceId,
              action: resourceLifecycleEvents.action,
              actorType: resourceLifecycleEvents.actorType,
              channel: resourceLifecycleEvents.channel,
              metadata: resourceLifecycleEvents.metadata,
              createdAt: resourceLifecycleEvents.createdAt,
            })
            .from(resourceLifecycleEvents)
            .where(
              inArray(resourceLifecycleEvents.resourceId, [
                newerContentId,
                olderContentId,
              ]),
            );
          assert.equal(lifecycleOrderEvents.length, 4);
          const sortLifecycleEvents = (events: typeof lifecycleOrderEvents) => events
            .map(({ createdAt: _createdAt, ...event }) => event)
            .sort((left, right) =>
              `${left.action}:${left.resourceId}`.localeCompare(
                `${right.action}:${right.resourceId}`,
              )
            );
          assert.deepEqual(
            sortLifecycleEvents(lifecycleOrderEvents),
            sortLifecycleEvents([
              {
                resourceId: olderContentId,
                action: "archive",
                actorType: "user",
                channel: "web",
                metadata: {},
              },
              {
                resourceId: newerContentId,
                action: "archive",
                actorType: "user",
                channel: "web",
                metadata: {},
              },
              {
                resourceId: olderContentId,
                action: "restore",
                actorType: "user",
                channel: "web",
                metadata: {},
              },
              {
                resourceId: newerContentId,
                action: "restore",
                actorType: "user",
                channel: "web",
                metadata: {},
              },
            ] as typeof lifecycleOrderEvents),
          );
          assert.ok(
            lifecycleOrderEvents.every(({ resourceId, createdAt }) =>
              createdAt.getTime() >
              (resourceId === newerContentId
                ? newerContentUpdatedAt
                : olderContentUpdatedAt
              ).getTime()
            ),
            "lifecycle events keep their own later created_at",
          );

          assert.deepEqual(
            (await repository.findArchivedAssistantMemories({
              userId: archiveListUserId,
              limit: 2,
            })).map((memory) => memory.key),
            ["archived_tie_high", "archived_tie_low"],
            "archived filtering and updated/id ordering happen before LIMIT",
          );

          assert.equal(
            (
              await repository.findArchivedAssistantMemoryById({
                userId: archiveListUserId,
                id: archivedTieHigh,
              })
            )?.key,
            "archived_tie_high",
          );

          for (const key of [
            "active_excluded",
            "private_excluded",
            "restricted_excluded",
            "other_archived_excluded",
          ]) {
            const [row] = await transaction
              .select({ id: coreMemories.id })
              .from(coreMemories)
              .where(eq(coreMemories.key, key))
              .limit(1);
            assert.ok(row);
            assert.equal(
              await repository.findArchivedAssistantMemoryById({
                userId: archiveListUserId,
                id: row.id,
              }),
              null,
            );
          }

          assert.equal(
            await repository.findArchivedAssistantMemoryById({
              userId: archiveListUserId,
              id: randomUUID(),
            }),
            null,
          );

          const restoreId = randomUUID();
          const restoreFields = {
            id: restoreId,
            userId: archiveListUserId,
            category: "project" as const,
            key: `restore_${restoreId}`,
            content: "Restore fixture",
            tags: ["keep"],
            visibility: "assistant" as const,
            source: "integration",
            status: "archived" as const,
            createdAt: contentTimestamp,
            updatedAt: contentTimestamp,
          };
          await transaction.insert(coreMemories).values(restoreFields);
          assert.equal(
            await repository.restoreMemory({
              id: restoreId,
              userId: archiveListUserId,
              actorType: "user",
              channel: "web",
            }),
            true,
          );
          const [restored] = await transaction
            .select()
            .from(coreMemories)
            .where(eq(coreMemories.id, restoreId))
            .limit(1);
          assert.ok(restored);
          assert.equal(restored.status, "active");
          assert.equal(
            restored.updatedAt.toISOString(),
            contentTimestamp.toISOString(),
          );
          for (const field of [
            "category",
            "key",
            "content",
            "tags",
            "source",
            "visibility",
          ] as const) {
            assert.deepEqual(restored[field], restoreFields[field]);
          }
          assert.equal(
            await repository.restoreMemory({
              id: restoreId,
              userId: archiveListUserId,
              actorType: "user",
              channel: "web",
            }),
            false,
          );

          for (const key of [
            "active_excluded",
            "private_excluded",
            "restricted_excluded",
            "other_archived_excluded",
          ]) {
            const [row] = await transaction
              .select({ id: coreMemories.id })
              .from(coreMemories)
              .where(eq(coreMemories.key, key))
              .limit(1);
            assert.ok(row);
            assert.equal(
              await repository.restoreMemory({
                id: row.id,
                userId: archiveListUserId,
                actorType: "user",
                channel: "web",
              }),
              false,
            );
          }
          assert.equal(
            await repository.restoreMemory({
              id: randomUUID(),
              userId: archiveListUserId,
              actorType: "user",
              channel: "web",
            }),
            false,
          );

          const partialUpdateId = updateIds.get("eligible")!;
          const [beforePartialUpdate] = await transaction
            .select({
              key: coreMemories.key,
              category: coreMemories.category,
              content: coreMemories.content,
              tags: coreMemories.tags,
              author: coreMemories.author,
            })
            .from(coreMemories)
            .where(eq(coreMemories.id, partialUpdateId))
            .limit(1);
          assert.ok(beforePartialUpdate);
          assert.equal(
            await repository.updateMemory({
              id: partialUpdateId,
              userId: ownerId,
              content: "Content-only update",
            }),
            true,
          );
          const [afterContentOnly] = await transaction
            .select({
              key: coreMemories.key,
              category: coreMemories.category,
              content: coreMemories.content,
              tags: coreMemories.tags,
              author: coreMemories.author,
            })
            .from(coreMemories)
            .where(eq(coreMemories.id, partialUpdateId))
            .limit(1);
          assert.deepEqual(afterContentOnly, {
            ...beforePartialUpdate,
            content: "Content-only update",
          });
          assert.equal(
            await repository.updateMemory({
              id: partialUpdateId,
              userId: ownerId,
              tags: [],
            }),
            true,
          );
          const [afterTagsClear] = await transaction
            .select({ tags: coreMemories.tags })
            .from(coreMemories)
            .where(eq(coreMemories.id, partialUpdateId))
            .limit(1);
          assert.deepEqual(afterTagsClear?.tags, []);

          for (const fixture of fixtures) {
            assert.equal(
              await repository.updateMemory({
                id: updateIds.get(fixture.name)!,
                userId: ownerId,
                key: `updated_${fixture.name}_${updateIds.get(fixture.name)!}`,
                category: "project",
                content: "Updated",
                tags: ["edited"],
              }),
              fixture.name === "eligible",
            );
            assert.equal(
              await repository.archiveMemory({
                id: archiveIds.get(fixture.name)!,
                userId: ownerId,
                actorType: "user",
                channel: "web",
              }),
              fixture.name === "eligible",
            );
          }

          assert.equal(
            await repository.updateMemory({
              id: randomUUID(),
              userId: ownerId,
              key: "missing_key",
              category: "project",
              content: "Missing",
              tags: ["edited"],
            }),
            false,
          );
          assert.equal(
            await repository.archiveMemory({
              id: randomUUID(),
              userId: ownerId,
              actorType: "user",
              channel: "web",
            }),
            false,
          );
          assert.equal(
            await repository.archiveMemory({
              id: archiveIds.get("eligible")!,
              userId: ownerId,
              actorType: "user",
              channel: "web",
            }),
            false,
            "a repeated archive must not report success",
          );

          const persisted = await transaction
            .select({
              id: coreMemories.id,
              content: coreMemories.content,
              key: coreMemories.key,
              category: coreMemories.category,
              tags: coreMemories.tags,
              status: coreMemories.status,
              updatedAt: coreMemories.updatedAt,
            })
            .from(coreMemories)
            .where(
              and(
                eq(coreMemories.userId, ownerId),
                eq(coreMemories.source, "integration"),
              ),
            );
          const byId = new Map(
            persisted.map((memory) => [memory.id, memory]),
          );

          for (const fixture of fixtures) {
            const updateId = updateIds.get(fixture.name)!;
            assert.equal(
              byId.get(updateId)?.content,
              fixture.name === "eligible"
                ? "Updated"
                : "Original update fixture",
            );
            assert.equal(
              byId.get(updateId)?.key,
              fixture.name === "eligible"
                ? `updated_${fixture.name}_${updateId}`
                : `update_${fixture.name}_${updateId}`,
            );
            assert.equal(
              byId.get(updateId)?.category,
              fixture.name === "eligible" ? "project" : "goal",
            );
            assert.deepEqual(
              byId.get(updateId)?.tags,
              fixture.name === "eligible" ? ["edited"] : [],
            );
            assert.equal(
              byId.get(archiveIds.get(fixture.name)!)?.status,
              fixture.name === "eligible"
                ? "archived"
                : fixture.status,
            );
          }
          assert.notEqual(
            byId.get(updateIds.get("eligible")!)?.updatedAt.toISOString(),
            contentTimestamp.toISOString(),
            "normal Memory content editing changes updated_at",
          );
          assert.equal(
            byId.get(archiveIds.get("eligible")!)?.updatedAt.toISOString(),
            contentTimestamp.toISOString(),
            "archive preserves the content updated_at",
          );

          const lifecycleEvents = await transaction
            .select({
              userId: resourceLifecycleEvents.userId,
              resourceType: resourceLifecycleEvents.resourceType,
              resourceId: resourceLifecycleEvents.resourceId,
              action: resourceLifecycleEvents.action,
              actorType: resourceLifecycleEvents.actorType,
              channel: resourceLifecycleEvents.channel,
              metadata: resourceLifecycleEvents.metadata,
              createdAt: resourceLifecycleEvents.createdAt,
            })
            .from(resourceLifecycleEvents)
            .where(
              inArray(resourceLifecycleEvents.resourceId, [
                restoreId,
                ...archiveIds.values(),
              ]),
            );
          assert.equal(lifecycleEvents.length, 2);
          assert.ok(
            lifecycleEvents.every(
              (event) => event.createdAt instanceof Date,
            ),
            "successful lifecycle events receive a database created_at",
          );
          assert.ok(
            lifecycleEvents.every(
              (event) =>
                event.createdAt.getTime() >
                contentTimestamp.getTime(),
            ),
            "lifecycle created_at is independent from content updated_at",
          );
          assert.deepEqual(
            lifecycleEvents
              .map(({ createdAt: _createdAt, ...event }) => event)
              .sort((left, right) =>
                left.resourceId.localeCompare(right.resourceId)
              ),
            [
              {
                userId: ownerId,
                resourceType: "memory",
                resourceId: archiveIds.get("eligible")!,
                action: "archive",
                actorType: "user",
                channel: "web",
                metadata: {},
              },
              {
                userId: archiveListUserId,
                resourceType: "memory",
                resourceId: restoreId,
                action: "restore",
                actorType: "user",
                channel: "web",
                metadata: {},
              },
            ].sort((left, right) =>
              left.resourceId.localeCompare(right.resourceId)
            ),
            "only successful lifecycle mutations append one structural audit event",
          );

          const rollbackArchiveId = randomUUID();
          const rollbackRestoreId = randomUUID();
          await transaction.insert(coreMemories).values([
            {
              id: rollbackArchiveId,
              userId: ownerId,
              category: "goal",
              key: `rollback_archive_${rollbackArchiveId}`,
              content: "Rollback archive fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "active",
            },
            {
              id: rollbackRestoreId,
              userId: ownerId,
              category: "goal",
              key: `rollback_restore_${rollbackRestoreId}`,
              content: "Rollback restore fixture",
              tags: [],
              visibility: "assistant",
              source: "integration",
              status: "archived",
            },
          ]);
          const failingRepository = new DrizzleMemoryRepository(
            transaction as never,
            {
              async record() {
                throw new Error("simulated_audit_failure");
              },
            },
          );

          await assert.rejects(
            failingRepository.archiveMemory({
              id: rollbackArchiveId,
              userId: ownerId,
              actorType: "user",
              channel: "web",
            }),
            /simulated_audit_failure/,
          );
          await assert.rejects(
            failingRepository.restoreMemory({
              id: rollbackRestoreId,
              userId: ownerId,
              actorType: "user",
              channel: "web",
            }),
            /simulated_audit_failure/,
          );
          const rollbackRows = await transaction
            .select({
              id: coreMemories.id,
              status: coreMemories.status,
            })
            .from(coreMemories)
            .where(
              inArray(coreMemories.id, [
                rollbackArchiveId,
                rollbackRestoreId,
              ]),
            );
          assert.deepEqual(
            new Map(
              rollbackRows.map((row) => [row.id, row.status]),
            ),
            new Map([
              [rollbackArchiveId, "active"],
              [rollbackRestoreId, "archived"],
            ]),
            "audit insert failure rolls back the lifecycle state update",
          );
          const rollbackEvents = await transaction
            .select({ id: resourceLifecycleEvents.id })
            .from(resourceLifecycleEvents)
            .where(
              inArray(resourceLifecycleEvents.resourceId, [
                rollbackArchiveId,
                rollbackRestoreId,
              ]),
            );
          assert.equal(
            rollbackEvents.length,
            0,
            "failed audit persistence leaves zero lifecycle events",
          );

          throw new RollbackMemoryLifecycleTest();
        }),
        RollbackMemoryLifecycleTest,
      );
    } finally {
      await database.close();
    }
  },
);
