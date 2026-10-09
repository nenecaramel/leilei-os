import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleExportRepository } from "../src/domains/export/export-repository.js";
import { DrizzleGlobalSearchRepository } from "../src/domains/global-search/global-search-repository.js";
import { DrizzleDiaryRepository } from "../src/domains/diary/diary-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const host = databaseUrl ? new URL(databaseUrl).hostname : null;
const enabled = process.env.RUN_PERMANENT_DELETE_DATABASE_TEST === "1"
  && Boolean(databaseUrl) && (host === "localhost" || host === "127.0.0.1");
class RollbackFixture extends Error {}

test("permanent deletion removes canonical Diary from search, export, and direct reads while retaining minimal audit", { skip: !enabled }, async () => {
  const client = postgres(databaseUrl!, { max: 1, prepare: false, ssl: false });
  const db = drizzle(client, { schema });
  try {
    await assert.rejects(db.transaction(async (tx) => {
      const userId = randomUUID();
      const id = randomUUID();
      await tx.insert(schema.users).values({ id: userId, email: `${userId}@example.invalid`, displayName: "Delete invariant", status: "active" });
      await tx.insert(schema.diaryEntries).values({ id, userId, title: "Deleted diary", content: "private deleted content", date: "2026-08-20", tags: [], author: "L", status: "archived", source: "chatgpt_mcp", idempotencyKey: "delete-invariant-diary", requestHash: "a".repeat(64) });
      await tx.insert(schema.toolCalls).values({ userId, toolName: "write_diary", operation: "create", resourceType: "diary_entry", resourceId: id, idempotencyKey: "delete-invariant-diary", requestSummary: { title: "private" }, resultSummary: { id }, durationMs: 1, status: "success" });
      await tx.insert(schema.resourceLifecycleEvents).values({ userId, resourceType: "diary", resourceId: id, action: "archive", actorType: "user", channel: "web", metadata: { title: "private" } });
      await tx.insert(schema.mcpWriteIdempotency).values({ userId, toolName: "write_diary", idempotencyKey: "delete-invariant-diary", requestHash: "a".repeat(64), resourceType: "diary_entry", resourceId: id });
      const diary = new DrizzleDiaryRepository(tx as never);
      assert.equal(await diary.permanentlyDeleteDiary!({ userId, id, actorType: "user", channel: "web" }), true);
      assert.equal(await diary.findArchivedDiaryById(userId, id), null);
      const exported = await new DrizzleExportRepository(tx as never).listDiary(userId);
      assert.equal(exported.some(row => row.id === id), false);
      const found = await new DrizzleGlobalSearchRepository(tx as never, "G").search({ userId, query: "Deleted diary", modules: ["diary"], scope: "all", mode: "normal", timezone: "Asia/Shanghai", limit: 20 });
      assert.equal(found.length, 0);
      const ledger = await tx.select({ resourceType: schema.mcpWriteIdempotency.resourceType }).from(schema.mcpWriteIdempotency).where(eq(schema.mcpWriteIdempotency.userId, userId));
      assert.deepEqual(ledger, [{ resourceType: "diary_entry" }]);
      const events = await tx.select({ resourceType: schema.resourceLifecycleEvents.resourceType, resourceId: schema.resourceLifecycleEvents.resourceId, action: schema.resourceLifecycleEvents.action, metadata: schema.resourceLifecycleEvents.metadata }).from(schema.resourceLifecycleEvents).where(eq(schema.resourceLifecycleEvents.userId, userId));
      assert.deepEqual(events, [{ resourceType: "diary", resourceId: id, action: "permanent_delete", metadata: {} }]);
      assert.deepEqual(await tx.select({ id: schema.toolCalls.id }).from(schema.toolCalls).where(eq(schema.toolCalls.userId, userId)), []);
      throw new RollbackFixture();
    }), RollbackFixture);
  } finally { await client.end(); }
});
