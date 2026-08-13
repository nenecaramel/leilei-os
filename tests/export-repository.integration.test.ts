import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import test from "node:test";
import * as schema from "../src/database/schema.js";
import { DrizzleExportRepository } from "../src/domains/export/export-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedUrl = databaseUrl ? new URL(databaseUrl) : null;
const runIntegration = process.env.RUN_EXPORT_DATABASE_TEST === "1"
  && Boolean(databaseUrl)
  && (parsedUrl?.hostname === "127.0.0.1" || parsedUrl?.hostname === "localhost");

class RollbackExportTest extends Error {}

test("DrizzleExportRepository returns scoped deterministic privacy-safe records", {
  skip: !runIntegration,
}, async () => {
  const client = postgres(databaseUrl!, { prepare: false, ssl: false, max: 1 });
  const db = drizzle(client, { schema });
  const owner = randomUUID();
  const other = randomUUID();
  const ownerMemoryEarly = randomUUID();
  const ownerMemoryLate = randomUUID();
  const ownerDiaryEarly = randomUUID();
  const ownerDiaryLate = randomUUID();
  const otherDiary = randomUUID();
  const ownerTaskEarly = randomUUID();
  const ownerTaskLate = randomUUID();
  const ownerLifecycleEarly = randomUUID();
  const ownerLifecycleLate = randomUUID();
  const otherLifecycle = randomUUID();
  const ownerToolEarly = randomUUID();
  const ownerToolLate = randomUUID();
  const otherTool = randomUUID();
  const ownerPaper = randomUUID();
  const ownerEmptyPaper = randomUUID();
  const now = new Date("2026-08-13T05:00:00.000Z");
  const early = new Date("2026-08-12T05:00:00.000Z");
  try {
    await assert.rejects(db.transaction(async (transaction) => {
      await transaction.insert(schema.users).values([
        { id: owner, email: `export-owner-${owner}@example.invalid`, displayName: "Export owner", status: "active", createdAt: now, updatedAt: now },
        { id: other, email: `export-other-${other}@example.invalid`, displayName: "Export other", status: "active", createdAt: now, updatedAt: now },
      ]);
      await transaction.insert(schema.coreMemories).values([
        { id: ownerMemoryEarly, userId: owner, category: "project", key: "early", content: "owner early", tags: ["one"], visibility: "assistant", source: "web", author: "L", status: "active", sortOrder: 1, createdAt: early, updatedAt: early },
        { id: ownerMemoryLate, userId: owner, category: "project", key: "late", content: "owner late", tags: ["two"], visibility: "assistant", source: "mcp", author: "G", status: "archived", sortOrder: 2, createdAt: now, updatedAt: now },
        { id: randomUUID(), userId: other, category: "project", key: "other-secret", content: "OTHER_MEMORY_SECRET", tags: [], visibility: "assistant", source: "web", author: "L", status: "active", createdAt: now, updatedAt: now },
      ]);
      await transaction.insert(schema.diaryEntries).values([
        { id: ownerDiaryEarly, userId: owner, title: "early diary", content: "owner early diary", date: "2026-08-11", tags: ["a"], mood: "calm", source: "web", author: "L", status: "active", idempotencyKey: `export-diary-early-${owner}`, requestHash: "a".repeat(64), createdAt: early, updatedAt: early },
        { id: ownerDiaryLate, userId: owner, title: "late diary", content: "owner late diary", date: "2026-08-12", tags: ["b"], mood: null, source: "chatgpt_mcp", author: "G", status: "archived", idempotencyKey: `export-diary-late-${owner}`, requestHash: "b".repeat(64), createdAt: now, updatedAt: now },
        { id: otherDiary, userId: other, title: "other diary", content: "OTHER_DIARY_SECRET", date: "2026-08-13", tags: [], mood: null, source: "web", author: "L", status: "active", idempotencyKey: `export-diary-other-${other}`, requestHash: "c".repeat(64), createdAt: now, updatedAt: now },
      ]);
      await transaction.insert(schema.tasks).values([
        { id: ownerTaskEarly, userId: owner, title: "early task", description: "owner early task", status: "pending", resumeStatus: null, lifecycleStatus: "active", author: "L", priority: "normal", dueTime: null, timezone: "Asia/Shanghai", tags: ["a"], createdAt: early, updatedAt: early, completedAt: null },
        { id: ownerTaskLate, userId: owner, title: "late task", description: "owner late task", status: "completed", resumeStatus: "in_progress", lifecycleStatus: "archived", author: "G", priority: "high", dueTime: now, timezone: "Asia/Shanghai", tags: ["b"], createdAt: now, updatedAt: now, completedAt: now },
        { id: randomUUID(), userId: other, title: "other task", description: "OTHER_TASK_SECRET", status: "pending", resumeStatus: null, lifecycleStatus: "active", author: "L", priority: "low", dueTime: null, timezone: "Asia/Shanghai", tags: [], createdAt: now, updatedAt: now, completedAt: null },
      ]);
      await transaction.insert(schema.todoPapers).values([
        { id: ownerPaper, userId: owner, businessDate: "2026-08-12", author: "L", revision: 3, createdAt: early, updatedAt: now },
        { id: ownerEmptyPaper, userId: owner, businessDate: "2026-08-13", author: "G", revision: 4, createdAt: now, updatedAt: now },
        { id: randomUUID(), userId: other, businessDate: "2026-08-14", author: "L", revision: 1, createdAt: now, updatedAt: now },
      ]);
      await transaction.insert(schema.todoEntries).values([
        { paperId: ownerPaper, entryId: "second", kind: "record", text: "second entry", position: 1 },
        { paperId: ownerPaper, entryId: "first", kind: "pending", text: "first entry", position: 0 },
      ]);
      await transaction.insert(schema.resourceLifecycleEvents).values([
        { id: ownerLifecycleEarly, userId: owner, resourceType: "memory", resourceId: ownerMemoryEarly, action: "archive", actorType: "user", channel: "web", metadata: { PRIVATE_LIFECYCLE_METADATA: true }, createdAt: early },
        { id: ownerLifecycleLate, userId: owner, resourceType: "diary", resourceId: ownerDiaryLate, action: "restore", actorType: "assistant", channel: "mcp", metadata: { PRIVATE_LIFECYCLE_METADATA: true }, createdAt: now },
        { id: otherLifecycle, userId: other, resourceType: "memory", resourceId: randomUUID(), action: "archive", actorType: "user", channel: "web", metadata: { OTHER_SECRET: true }, createdAt: now },
      ]);
      await transaction.insert(schema.mcpWriteIdempotency).values([
        { id: randomUUID(), userId: owner, toolName: "write_memory", idempotencyKey: `export-mcp-key-${owner}`, requestHash: "d".repeat(64), resourceType: "memory", resourceId: ownerMemoryEarly, createdAt: now },
        { id: randomUUID(), userId: other, toolName: "write_memory", idempotencyKey: `export-mcp-key-${other}`, requestHash: "e".repeat(64), resourceType: "memory", resourceId: randomUUID(), createdAt: now },
      ]);
      await transaction.insert(schema.toolCalls).values([
        { id: ownerToolEarly, userId: owner, toolName: "write_memory", operation: "create", resourceType: "memory", resourceId: ownerMemoryEarly, idempotencyKey: `export-mcp-key-${owner}`, requestSummary: { PRIVATE_REQUEST_SUMMARY: true }, resultSummary: { PRIVATE_RESULT_SUMMARY: true }, durationMs: 10, status: "success", errorCode: null, createdAt: early },
        { id: ownerToolLate, userId: owner, toolName: "write_memory", operation: "create", resourceType: "memory", resourceId: ownerMemoryLate, idempotencyKey: null, requestSummary: { PRIVATE_REQUEST_SUMMARY: true }, resultSummary: { PRIVATE_RESULT_SUMMARY: true }, durationMs: 11, status: "success", errorCode: null, createdAt: now },
        { id: otherTool, userId: other, toolName: "write_memory", operation: "create", resourceType: "memory", resourceId: otherDiary, idempotencyKey: `export-mcp-key-${other}`, requestSummary: {}, resultSummary: {}, durationMs: 12, status: "success", errorCode: null, createdAt: now },
      ]);

      const repository = new DrizzleExportRepository(transaction as never);
      const memories = await repository.listMemory(owner);
      assert.deepEqual(memories.map((row) => row.id), [ownerMemoryEarly, ownerMemoryLate]);
      assert.equal("user_id" in (memories[0] ?? {}), false);
      assert.equal(JSON.stringify(memories).includes("OTHER_MEMORY_SECRET"), false);

      const diaries = await repository.listDiary(owner);
      assert.deepEqual(diaries.map((row) => row.id), [ownerDiaryEarly, ownerDiaryLate]);
      assert.equal("idempotency_key" in (diaries[0] ?? {}), false);
      assert.equal("request_hash" in (diaries[0] ?? {}), false);
      assert.equal(JSON.stringify(diaries).includes("OTHER_DIARY_SECRET"), false);

      const tasks = await repository.listTasks(owner);
      assert.deepEqual(tasks.map((row) => row.id), [ownerTaskEarly, ownerTaskLate]);
      assert.equal("user_id" in (tasks[0] ?? {}), false);
      assert.equal(JSON.stringify(tasks).includes("OTHER_TASK_SECRET"), false);

      const papers = await repository.listTodo(owner);
      assert.deepEqual(papers.map((row) => `${row.date}:${row.author}`), ["2026-08-12:L", "2026-08-13:G"]);
      assert.deepEqual(papers[0]?.entries, [
        { id: "first", kind: "pending", text: "first entry" },
        { id: "second", kind: "record", text: "second entry" },
      ]);
      assert.deepEqual(papers[1]?.entries, []);
      assert.equal(JSON.stringify(papers).includes(ownerPaper), false);

      const lifecycle = await repository.listLifecycleAudit(owner);
      assert.deepEqual(lifecycle.map((row) => row.id), [ownerLifecycleEarly, ownerLifecycleLate]);
      assert.equal(JSON.stringify(lifecycle).includes("PRIVATE_LIFECYCLE_METADATA"), false);

      const tools = await repository.listToolActivity(owner);
      assert.deepEqual(tools.map((row) => row.id), [ownerToolEarly]);
      const toolJson = JSON.stringify(tools);
      for (const forbidden of ["idempotency_key", "request_summary", "result_summary", "duration_ms", "PRIVATE_REQUEST_SUMMARY", "PRIVATE_RESULT_SUMMARY"]) {
        assert.equal(toolJson.includes(forbidden), false);
      }

      throw new RollbackExportTest();
    }), RollbackExportTest);
  } finally {
    await client.end();
  }
});
