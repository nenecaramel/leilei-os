import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/database/schema.js";
import { diaryEntries, users } from "../src/database/schema.js";
import { DiaryService } from "../src/domains/diary/diary-service.js";
import { DrizzleDiaryRepository } from "../src/domains/diary/diary-repository.js";

const RUN_INTEGRATION = process.env.RUN_DATABASE_INTEGRATION_TEST === "1" && Boolean(process.env.DATABASE_URL);
class RollbackDiaryDiscoveryTest extends Error {}

function createLocalDatabase(url: string) {
  const client = postgres(url, { max: 4, prepare: false, ssl: false });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

test("Diary compact search keeps long bodies out of discovery results", { skip: !RUN_INTEGRATION }, async () => {
  const database = createLocalDatabase(process.env.DATABASE_URL!);
  try {
    await assert.rejects(database.db.transaction(async (transaction) => {
      const userId = randomUUID();
      const now = new Date("2026-08-25T00:00:00.000Z");
      await transaction.insert(users).values({
        id: userId,
        email: `diary-discovery-${userId}@example.invalid`,
        displayName: "Diary discovery owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(diaryEntries).values({
        userId,
        title: "title needle",
        content: `${"前".repeat(200)} bodyneedle ${"后".repeat(200)}`,
        date: "2026-08-25",
        tags: ["travel"],
        mood: "focused",
        status: "active",
        updatedAt: now,
      });

      const service = new DiaryService(new DrizzleDiaryRepository(transaction as never));
      const bodyMatch = await service.searchDiaryDiscovery({ userId, query: { q: "bodyneedle" } });
      assert.equal(bodyMatch.diaries.length, 1);
      assert.match(String(bodyMatch.diaries[0]!.snippet), /bodyneedle/);
      assert.equal("content" in bodyMatch.diaries[0]!, false);
      assert.equal(Array.from(String(bodyMatch.diaries[0]!.snippet)).length <= 240, true);

      const titleOnly = await service.searchDiaryDiscovery({ userId, query: { q: "title needle" } });
      assert.equal(titleOnly.diaries[0]!.snippet, null);
      const filterOnly = await service.searchDiaryDiscovery({ userId, query: { tag: "travel" } });
      assert.equal(filterOnly.diaries[0]!.snippet, null);

      throw new RollbackDiaryDiscoveryTest();
    }), RollbackDiaryDiscoveryTest);
  } finally {
    await database.close();
  }
});
