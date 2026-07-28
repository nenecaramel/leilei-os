import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
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

class RollbackMemoryTagTest extends Error {}

test(
  "real Memory repository keeps tags exact, scoped, visible, active, and AND-filtered",
  { skip: !RUN_INTEGRATION },
  async () => {
    const database = createDatabase(process.env.DATABASE_URL!);

    try {
      await assert.rejects(
        database.db.transaction(async (transaction) => {
          const ownerId = randomUUID();
          const otherUserId = randomUUID();
          const now = new Date("2026-07-28T08:00:00.000Z");

          await transaction.insert(users).values([
            {
              id: ownerId,
              email: `memory-tags-${ownerId}@example.invalid`,
              displayName: "Memory tags owner",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
            {
              id: otherUserId,
              email: `memory-tags-${otherUserId}@example.invalid`,
              displayName: "Memory tags other user",
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          ]);

          await transaction.insert(coreMemories).values([
            {
              userId: ownerId,
              category: "goal",
              key: "exact_visible_goal",
              content: "Exact visible goal",
              tags: ["filter-test", "shared"],
              visibility: "assistant",
              source: "integration",
              status: "active",
            },
            {
              userId: ownerId,
              category: "project",
              key: "complete_filter",
              content: "Complete filter tag",
              tags: ["filter"],
              visibility: "assistant",
              source: "integration",
              status: "active",
            },
            {
              userId: ownerId,
              category: "goal",
              key: "archived_secret",
              content: "Archived fixture",
              tags: ["archived-only"],
              visibility: "assistant",
              source: "integration",
              status: "archived",
            },
            {
              userId: ownerId,
              category: "goal",
              key: "private_secret",
              content: "Private fixture",
              tags: ["private-only"],
              visibility: "private",
              source: "integration",
              status: "active",
            },
            {
              userId: otherUserId,
              category: "goal",
              key: "other_secret",
              content: "Other user fixture",
              tags: ["other-only", "filter-test"],
              visibility: "assistant",
              source: "integration",
              status: "active",
            },
          ]);

          const repository = new DrizzleMemoryRepository(
            transaction as never,
          );
          const find = (input: {
            query?: string;
            categories?: readonly ("goal" | "project")[];
            tag?: string;
          }) => repository.findActiveAssistantMemories({
            userId: ownerId,
            limit: 50,
            ...input,
          });

          const exact = await find({ tag: "filter-test" });
          assert.deepEqual(exact.map((memory) => memory.key), [
            "exact_visible_goal",
          ]);
          assert.deepEqual(await find({ tag: "test" }), []);
          assert.deepEqual(
            (await find({ tag: "filter" })).map((memory) => memory.key),
            ["complete_filter"],
          );
          assert.deepEqual(
            (await find({
              query: "visible",
              categories: ["goal"],
              tag: "filter-test",
            })).map((memory) => memory.key),
            ["exact_visible_goal"],
          );
          assert.deepEqual(
            await repository.findActiveAssistantMemoryTags(ownerId),
            ["filter", "filter-test", "shared"],
          );

          throw new RollbackMemoryTagTest();
        }),
        RollbackMemoryTagTest,
      );
    } finally {
      await database.close();
    }
  },
);
