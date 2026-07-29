import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/database/client.js";
import {
  coreMemories,
  users,
} from "../src/database/schema.js";
import {
  DrizzleMemoryRepository,
} from "../src/domains/memory/memory-repository.js";

const RUN_INTEGRATION =
  process.env.RUN_DATABASE_INTEGRATION_TEST === "1" &&
  Boolean(process.env.DATABASE_URL);

class RollbackMemoryLifecycleTest extends Error {}

test(
  "real Memory repository updates and archives only owned active assistant-visible rows",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createDatabase(process.env.DATABASE_URL!);

    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const ownerId = randomUUID();
          const otherUserId = randomUUID();
          const archiveListUserId = randomUUID();
          const now = new Date("2026-07-29T00:00:00.000Z");

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
              },
            ]);
          }

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

          for (const fixture of fixtures) {
            assert.equal(
              await repository.updateMemory({
                id: updateIds.get(fixture.name)!,
                userId: ownerId,
                content: "Updated",
              }),
              fixture.name === "eligible",
            );
            assert.equal(
              await repository.archiveMemory({
                id: archiveIds.get(fixture.name)!,
                userId: ownerId,
              }),
              fixture.name === "eligible",
            );
          }

          assert.equal(
            await repository.updateMemory({
              id: randomUUID(),
              userId: ownerId,
              content: "Missing",
            }),
            false,
          );
          assert.equal(
            await repository.archiveMemory({
              id: randomUUID(),
              userId: ownerId,
            }),
            false,
          );
          assert.equal(
            await repository.archiveMemory({
              id: archiveIds.get("eligible")!,
              userId: ownerId,
            }),
            false,
            "a repeated archive must not report success",
          );

          const persisted = await transaction
            .select({
              id: coreMemories.id,
              content: coreMemories.content,
              status: coreMemories.status,
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
            assert.equal(
              byId.get(updateIds.get(fixture.name)!)?.content,
              fixture.name === "eligible"
                ? "Updated"
                : "Original update fixture",
            );
            assert.equal(
              byId.get(archiveIds.get(fixture.name)!)?.status,
              fixture.name === "eligible"
                ? "archived"
                : fixture.status,
            );
          }

          throw new RollbackMemoryLifecycleTest();
        }),
        RollbackMemoryLifecycleTest,
      );
    } finally {
      await database.close();
    }
  },
);
