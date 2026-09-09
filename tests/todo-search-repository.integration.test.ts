import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { todoEntries, todoPapers, users } from "../src/database/schema.js";
import { DrizzleTodoRepository } from "../src/domains/todo/todo-repository.js";

const runIntegration = process.env.RUN_TODO_SEARCH_DATABASE_TEST === "1" && Boolean(process.env.DATABASE_URL);
class RollbackTodoSearchTest extends Error {}

test("Todo search repository returns entry-granular normalized, filtered results", { skip: !runIntegration }, async () => {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false, ssl: false });
  const database = drizzle(client, { schema });
  const userId = randomUUID();
  const otherUserId = randomUUID();
  try {
    await assert.rejects(database.transaction(async (transaction) => {
      const now = new Date("2026-09-01T00:00:00.000Z");
      await transaction.insert(users).values([
        { id: userId, email: `${userId}@example.invalid`, displayName: "Todo search owner", status: "active", createdAt: now, updatedAt: now },
        { id: otherUserId, email: `${otherUserId}@example.invalid`, displayName: "Todo search other", status: "active", createdAt: now, updatedAt: now },
      ]);
      const paperId = randomUUID();
      const otherPaperId = randomUUID();
      await transaction.insert(todoPapers).values([
        { id: paperId, userId, businessDate: "2026-09-01", author: "C", revision: 1, createdAt: now, updatedAt: now },
        { id: otherPaperId, userId: otherUserId, businessDate: "2026-09-01", author: "C", revision: 1, createdAt: now, updatedAt: now },
      ]);
      await transaction.insert(todoEntries).values([
        { paperId, entryId: "c-1", kind: "pending", text: "  Cafe\u0301   plan  ", position: 0 },
        { paperId, entryId: "c-2", kind: "completed", text: "Plan the follow-up", position: 1 },
        { paperId: otherPaperId, entryId: "other-1", kind: "pending", text: "Plan for another owner", position: 0 },
      ]);
      const repository = new DrizzleTodoRepository(transaction as never);
      const normalized = await repository.searchEntries({ userId, query: "café plan", author: "C", kind: "pending", dateFrom: "2026-09-01", dateTo: "2026-09-01", limit: 10 });
      assert.equal(normalized.length, 1);
      assert.deepEqual(normalized[0], { id: normalized[0]!.id, entryId: "c-1", date: "2026-09-01", author: "C", kind: "pending", text: "  Café   plan  " });
      const all = await repository.searchEntries({ userId, query: "plan", limit: 10 });
      assert.deepEqual(all.map((entry) => entry.entryId), ["c-1", "c-2"]);
      throw new RollbackTodoSearchTest();
    }), RollbackTodoSearchTest);
  } finally {
    await client.end();
  }
});
