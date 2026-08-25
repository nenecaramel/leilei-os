import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/database/schema.js";
import { coreMemories, users } from "../src/database/schema.js";
import { MemoryService } from "../src/domains/memory/memory-service.js";
import { DrizzleMemoryRepository } from "../src/domains/memory/memory-repository.js";

const RUN_INTEGRATION = process.env.RUN_DATABASE_INTEGRATION_TEST === "1" && Boolean(process.env.DATABASE_URL);
class RollbackMemoryDiscoveryTest extends Error {}

function createLocalDatabase(url: string) {
  const client = postgres(url, { max: 4, prepare: false, ssl: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

test("Memory discovery keeps long bodies out of compact repository/service projections", { skip: !RUN_INTEGRATION }, async () => {
  const database = createLocalDatabase(process.env.DATABASE_URL!);
  try {
    await assert.rejects(database.db.transaction(async (transaction) => {
      const userId = randomUUID();
      const memoryId = randomUUID();
      const now = new Date("2026-08-25T00:00:00.000Z");
      const longBody = `${"前".repeat(49_990)} bodyneedle ${"后".repeat(49_990)}`;
      await transaction.insert(users).values({
        id: userId,
        email: `memory-discovery-${userId}@example.invalid`,
        displayName: "Memory discovery owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(coreMemories).values([
        {
          id: memoryId,
          userId,
          category: "goal",
          key: "keyneedle",
          content: longBody,
          tags: ["visible"],
          visibility: "assistant",
          source: "integration",
          status: "active",
          updatedAt: now,
        },
        {
          userId,
          category: "goal",
          key: "private-keyneedle",
          content: "private bodyneedle",
          tags: ["private"],
          visibility: "private",
          source: "integration",
          status: "active",
        },
        {
          userId,
          category: "goal",
          key: "project_alpha",
          content: "metadata only",
          tags: ["visible"],
          visibility: "assistant",
          source: "integration",
          status: "active",
        },
        {
          userId,
          category: "goal",
          key: "foo_bar",
          content: "foo   bar",
          tags: ["visible"],
          visibility: "assistant",
          source: "integration",
          status: "active",
        },
      ]);

      const service = new MemoryService(new DrizzleMemoryRepository(transaction as never));
      const directory = await service.readMemoryDiscovery({ userId });
      assert.equal(directory.memories.length, 3);
      assert.equal(directory.memories.every((memory) => !("content" in memory)), true);
      assert.equal(directory.memories.every((memory) => Array.from(memory.preview).length <= 240), true);

      const bodyMatch = await service.searchMemoryDiscovery({ userId, query: "bodyneedle" });
      assert.equal(bodyMatch.memories.length, 1);
      assert.match(String(bodyMatch.memories[0]!.snippet), /bodyneedle/);
      assert.equal(Array.from(String(bodyMatch.memories[0]!.snippet)).length <= 240, true);

      const keyOnly = await service.searchMemoryDiscovery({ userId, query: "keyneedle" });
      assert.equal(keyOnly.memories.length, 1);
      assert.equal(keyOnly.memories[0]!.snippet, null);

      const underscoreKey = await service.searchMemoryDiscovery({ userId, query: "project alpha" });
      assert.deepEqual(underscoreKey.memories.map((memory) => memory.key), ["project_alpha"]);
      assert.equal(underscoreKey.memories[0]!.snippet, null);

      const whitespaceKey = await service.searchMemoryDiscovery({ userId, query: "foo bar" });
      assert.deepEqual(whitespaceKey.memories.map((memory) => memory.key), ["foo_bar"]);
      assert.equal(whitespaceKey.memories[0]!.snippet, null);

      throw new RollbackMemoryDiscoveryTest();
    }), RollbackMemoryDiscoveryTest);
  } finally {
    await database.close();
  }
});
