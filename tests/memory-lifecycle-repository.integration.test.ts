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

          const repository = new DrizzleMemoryRepository(
            transaction as never,
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
