import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/database/schema.js";
import { DrizzleSystemRepository } from "../src/domains/system/system-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const runIntegration = process.env.RUN_SYSTEM_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsedUrl?.hostname === "127.0.0.1" || parsedUrl?.hostname === "localhost");

class RollbackSystemTest extends Error {}

test("real System repository scopes counts and activity to one user", { skip: !runIntegration }, async () => {
  const client = postgres(databaseUrl!, { max: 1, prepare: false, ssl: false });
  const db = drizzle(client, { schema });
  try {
    await assert.rejects(db.transaction(async (transaction) => {
      const owner = randomUUID();
      const other = randomUUID();
      const now = new Date("2026-08-09T00:00:00.000Z");
      await transaction.insert(schema.users).values([
        { id: owner, email: `system-owner-${owner}@example.invalid`, displayName: "System owner", status: "active" },
        { id: other, email: `system-other-${other}@example.invalid`, displayName: "System other", status: "active" },
      ]);
      await transaction.insert(schema.coreMemories).values([
        { id: randomUUID(), userId: owner, category: "project", key: "active memory", content: "owner", tags: [], visibility: "assistant", source: "web", status: "active", createdAt: now, updatedAt: now },
        { id: randomUUID(), userId: owner, category: "project", key: "archived memory", content: "owner", tags: [], visibility: "assistant", source: "web", status: "archived", createdAt: now, updatedAt: now },
        { id: randomUUID(), userId: owner, category: "project", key: "private active memory", content: "owner", tags: [], visibility: "private", source: "web", status: "active", createdAt: now, updatedAt: now },
        { id: randomUUID(), userId: owner, category: "project", key: "restricted archived memory", content: "owner", tags: [], visibility: "restricted", source: "web", status: "archived", createdAt: now, updatedAt: now },
        { id: randomUUID(), userId: other, category: "project", key: "other memory", content: "other", tags: [], visibility: "assistant", source: "web", status: "active", createdAt: now, updatedAt: now },
      ]);
      const ownerDiaryId = randomUUID();
      const ownerArchivedDiaryId = randomUUID();
      const otherDiaryId = randomUUID();
      await transaction.insert(schema.diaryEntries).values([
        { id: ownerDiaryId, userId: owner, title: "owner active", content: "owner", date: "2026-08-09", tags: [], mood: null, source: "chatgpt_mcp", status: "active", idempotencyKey: `system-${owner}-active`, requestHash: "a".repeat(64), createdAt: now, updatedAt: now },
        { id: ownerArchivedDiaryId, userId: owner, title: "owner archived", content: "owner", date: "2026-08-08", tags: [], mood: null, source: "chatgpt_mcp", status: "archived", idempotencyKey: `system-${owner}-archived`, requestHash: "b".repeat(64), createdAt: now, updatedAt: now },
        { id: otherDiaryId, userId: other, title: "other diary", content: "other", date: "2026-08-09", tags: [], mood: null, source: "chatgpt_mcp", status: "active", idempotencyKey: `system-${other}-active`, requestHash: "c".repeat(64), createdAt: now, updatedAt: now },
      ]);
      await transaction.insert(schema.tasks).values([
        { id: randomUUID(), userId: owner, title: "owner active task", description: "owner", status: "pending", resumeStatus: null, lifecycleStatus: "active", priority: "normal", dueTime: null, timezone: "Asia/Shanghai", tags: [], createdAt: now, updatedAt: now, completedAt: null },
        { id: randomUUID(), userId: owner, title: "owner archived task", description: "owner", status: "completed", resumeStatus: "in_progress", lifecycleStatus: "archived", priority: "normal", dueTime: null, timezone: "Asia/Shanghai", tags: [], createdAt: now, updatedAt: now, completedAt: now },
        { id: randomUUID(), userId: other, title: "other task", description: "other", status: "pending", resumeStatus: null, lifecycleStatus: "active", priority: "normal", dueTime: null, timezone: "Asia/Shanghai", tags: [], createdAt: now, updatedAt: now, completedAt: null },
      ]);
      await transaction.insert(schema.sharedPapers).values([
        { id: randomUUID(), userId: owner, title: "owner active shared paper", content: "owner", revision: 1, createdBy: "L", updatedBy: "L", createdAt: now, updatedAt: now, archivedAt: null },
        { id: randomUUID(), userId: owner, title: "owner archived shared paper", content: "owner", revision: 2, createdBy: "G", updatedBy: "C", createdAt: now, updatedAt: now, archivedAt: now },
        { id: randomUUID(), userId: other, title: "other shared paper", content: "other", revision: 1, createdBy: "C", updatedBy: "C", createdAt: now, updatedAt: now, archivedAt: null },
      ]);
      await transaction.insert(schema.todoPapers).values([
        { id: randomUUID(), userId: owner, businessDate: "2026-08-09", author: "L", revision: 1, createdAt: now, updatedAt: now },
        { id: randomUUID(), userId: owner, businessDate: "2026-08-10", author: "C", revision: 1, createdAt: now, updatedAt: now },
        { id: randomUUID(), userId: other, businessDate: "2026-08-09", author: "G", revision: 1, createdAt: now, updatedAt: now },
      ]);
      const ownerMemoryId = randomUUID();
      const otherMemoryId = randomUUID();
      await transaction.insert(schema.resourceLifecycleEvents).values([
        { id: randomUUID(), userId: owner, resourceType: "memory", resourceId: ownerMemoryId, action: "archive", actorType: "user", channel: "web", metadata: {}, createdAt: now },
        { id: randomUUID(), userId: other, resourceType: "memory", resourceId: otherMemoryId, action: "archive", actorType: "user", channel: "web", metadata: {}, createdAt: now },
      ]);

      const mcpResourceId = ownerDiaryId;
      await transaction.insert(schema.mcpWriteIdempotency).values({
        id: randomUUID(), userId: owner, toolName: "write_memory", idempotencyKey: `system-key-${owner}`, requestHash: "d".repeat(64), resourceType: "memory", resourceId: mcpResourceId, createdAt: now,
      });
      await transaction.insert(schema.toolCalls).values([
        { id: randomUUID(), userId: owner, toolName: "write_memory", operation: "create", resourceType: "memory", resourceId: mcpResourceId, idempotencyKey: `system-key-${owner}`, requestSummary: {}, resultSummary: {}, durationMs: 2, status: "success", errorCode: null, createdAt: now },
        { id: randomUUID(), userId: owner, toolName: "write_diary", operation: "create", resourceType: "diary_entry", resourceId: null, idempotencyKey: null, requestSummary: {}, resultSummary: {}, durationMs: 2, status: "success", errorCode: null, createdAt: now },
        { id: randomUUID(), userId: other, toolName: "write_memory", operation: "create", resourceType: "memory", resourceId: otherDiaryId, idempotencyKey: `other-key-${other}`, requestSummary: {}, resultSummary: {}, durationMs: 2, status: "success", errorCode: null, createdAt: now },
      ]);

      const repository = new DrizzleSystemRepository(transaction as never);
      assert.deepEqual(await repository.readDataSummary(owner), {
        memory: { active: 1, archived: 1 },
        diary: { active: 1, archived: 1 },
        task: { active: 1, archived: 1 },
        shared_paper: { active: 1, archived: 1 },
        todo: { active: 2 },
      });
      const lifecycle = await repository.listLifecycleActivity(owner, 10);
      assert.equal(lifecycle.length, 1);
      assert.equal(lifecycle[0]?.resourceType, "memory");
      const tools = await repository.listToolActivity(owner, 10);
      assert.deepEqual(tools.map((row) => row.source), ["mcp"]);
      assert.deepEqual(tools.map((row) => row.toolName), ["write_memory"]);
      await transaction.delete(schema.mcpWriteIdempotency).where(
        eq(schema.mcpWriteIdempotency.idempotencyKey, `system-key-${owner}`),
      );
      const toolsAfterLedgerRetention = await repository.listToolActivity(owner, 10);
      assert.deepEqual(toolsAfterLedgerRetention.map((row) => row.toolName), ["write_memory"]);
      assert.equal((await transaction.select().from(schema.mcpWriteIdempotency).where(and(eq(schema.mcpWriteIdempotency.userId, owner), eq(schema.mcpWriteIdempotency.resourceId, mcpResourceId)))).length, 0);
      throw new RollbackSystemTest();
    }), RollbackSystemTest);
  } finally {
    await client.end();
  }
});
