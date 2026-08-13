import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import test from "node:test";
import * as schema from "../src/database/schema.js";
import { ExportService } from "../src/domains/export/export-service.js";
import { DrizzleExportRepository } from "../src/domains/export/export-repository.js";
import { ImportService } from "../src/domains/import/import-service.js";
import { DrizzleImportRepository } from "../src/domains/import/import-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const run = process.env.RUN_IMPORT_DATABASE_TEST === "1" && Boolean(databaseUrl) && (target?.hostname === "localhost" || target?.hostname === "127.0.0.1");

test("isolated PostgreSQL export v2 round-trips through preview and atomic restore", { skip: !run }, async () => {
  const client = postgres(databaseUrl!, { prepare: false, ssl: false, max: 4 });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const memoryId = randomUUID();
  const diaryId = randomUUID();
  const taskId = randomUUID();
  const now = new Date("2026-08-14T00:00:00.000Z");
  try {
    await db.insert(schema.users).values({ id: userId, email: `import-${userId}@example.invalid`, displayName: "Import test", status: "active", createdAt: now, updatedAt: now });
    await db.insert(schema.coreMemories).values({ id: memoryId, userId, category: "profile", key: "import-name", content: "Leilei", tags: ["roundtrip"], visibility: "assistant", source: "web", author: "L", status: "active", sortOrder: 0, createdAt: now, updatedAt: now });
    await db.insert(schema.diaryEntries).values({ id: diaryId, userId, title: "Import diary", content: "A diary", date: "2026-08-14", tags: [], mood: null, source: "chatgpt_mcp", author: "G", status: "archived", idempotencyKey: `import-test-${userId}`, requestHash: "a".repeat(64), createdAt: now, updatedAt: now });
    await db.insert(schema.tasks).values({ id: taskId, userId, title: "Import task", description: "A task", status: "pending", resumeStatus: null, lifecycleStatus: "active", author: "L", priority: "normal", dueTime: null, timezone: "Asia/Shanghai", tags: [], createdAt: now, updatedAt: now, completedAt: null });
    await db.insert(schema.todoPapers).values({ userId, businessDate: "2026-08-14", author: "G", revision: 0, createdAt: now, updatedAt: now });

    const exported = await new ExportService(new DrizzleExportRepository(db as never), () => now).createExport(userId, "all", true);
    const raw = new TextEncoder().encode(JSON.stringify(exported));
    await db.delete(schema.coreMemories).where(eq(schema.coreMemories.userId, userId));
    await db.delete(schema.diaryEntries).where(eq(schema.diaryEntries.userId, userId));
    await db.delete(schema.tasks).where(eq(schema.tasks.userId, userId));
    await db.delete(schema.todoPapers).where(eq(schema.todoPapers.userId, userId));

    const service = new ImportService(new DrizzleImportRepository(db as never));
    const preview = await service.preview(raw, userId);
    assert.equal(preview.can_execute, true);
    const result = await service.execute(raw, userId, preview.preview_fingerprint);
    assert.equal(result.summary.memory.create, 1);
    assert.equal(result.summary.diary.create, 1);
    assert.equal(result.summary.task.create, 1);
    assert.equal(result.summary.todo.create, 1);
    const reexported = await new ExportService(new DrizzleExportRepository(db as never), () => now).createExport(userId, "all", false);
    assert.deepEqual(reexported.data, exported.data);
    assert.equal((await service.preview(raw, userId)).can_execute, false);
    const conflictPackage = { ...exported, data: { ...exported.data, memory: [{ ...exported.data.memory?.[0], content: "changed" }] } };
    const conflictRaw = new TextEncoder().encode(JSON.stringify(conflictPackage));
    const conflictPreview = await service.preview(conflictRaw, userId);
    assert.equal(conflictPreview.summary.memory.conflict, 1);
    await assert.rejects(service.execute(conflictRaw, userId, conflictPreview.preview_fingerprint), /IMPORT_CONFLICT/u);
    const [auditCount] = await db.select({ count: count() }).from(schema.dataImportRuns).where(eq(schema.dataImportRuns.userId, userId));
    assert.equal(auditCount?.count, 1);
    const [lifecycleCount] = await db.select({ count: count() }).from(schema.resourceLifecycleEvents).where(eq(schema.resourceLifecycleEvents.userId, userId));
    const [toolCount] = await db.select({ count: count() }).from(schema.toolCalls).where(eq(schema.toolCalls.userId, userId));
    assert.equal(lifecycleCount?.count, 0);
    assert.equal(toolCount?.count, 0);
  } finally {
    await db.delete(schema.dataImportRuns).where(eq(schema.dataImportRuns.userId, userId));
    const ownedPapers = await db.select({ id: schema.todoPapers.id }).from(schema.todoPapers).where(eq(schema.todoPapers.userId, userId));
    if (ownedPapers.length > 0) await db.delete(schema.todoEntries).where(eq(schema.todoEntries.paperId, ownedPapers[0]!.id));
    await db.delete(schema.todoPapers).where(eq(schema.todoPapers.userId, userId));
    await db.delete(schema.coreMemories).where(eq(schema.coreMemories.userId, userId));
    await db.delete(schema.diaryEntries).where(eq(schema.diaryEntries.userId, userId));
    await db.delete(schema.tasks).where(eq(schema.tasks.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.end();
  }
});

test("isolated PostgreSQL import rolls back all modules when a later insert fails", { skip: !run }, async () => {
  const client = postgres(databaseUrl!, { prepare: false, ssl: false, max: 4 });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const now = new Date("2026-08-14T00:00:00.000Z");
  try {
    await db.insert(schema.users).values({ id: userId, email: `import-rollback-${userId}@example.invalid`, displayName: "Import rollback", status: "active", createdAt: now, updatedAt: now });
    const exportDocument = {
      schema_version: 2 as const,
      owner_fingerprint: (await new ExportService(new DrizzleExportRepository(db as never), () => now).createExport(userId, "memory", false)).owner_fingerprint,
      exported_at: now.toISOString(),
      data: {
        memory: [{ id: randomUUID(), category: "profile" as const, key: "rollback-key", content: "rollback memory", tags: [], visibility: "assistant", source: "web", author: "L" as const, status: "active" as const, sort_order: 0, created_at: now.toISOString(), updated_at: now.toISOString() }],
        diary: [{ id: randomUUID(), title: "import-rollback", content: "rollback diary", date: "2026-08-14", tags: [], mood: null, source: "chatgpt_mcp" as const, author: "G" as const, status: "active" as const, created_at: now.toISOString(), updated_at: now.toISOString() }],
      },
    };
    const raw = new TextEncoder().encode(JSON.stringify(exportDocument));
    await db.execute(sql.raw("CREATE OR REPLACE FUNCTION fail_import_diary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'import rollback trigger'; END; $$"));
    await db.execute(sql.raw("CREATE TRIGGER fail_import_diary_trigger BEFORE INSERT ON diary_entries FOR EACH ROW EXECUTE FUNCTION fail_import_diary()"));
    try {
      const service = new ImportService(new DrizzleImportRepository(db as never));
      const preview = await service.preview(raw, userId);
      await assert.rejects(service.execute(raw, userId, preview.preview_fingerprint));
    } finally {
      await db.execute(sql.raw("DROP TRIGGER IF EXISTS fail_import_diary_trigger ON diary_entries"));
      await db.execute(sql.raw("DROP FUNCTION IF EXISTS fail_import_diary()"));
    }
    const [memoryCount] = await db.select({ count: count() }).from(schema.coreMemories).where(eq(schema.coreMemories.userId, userId));
    const [auditCount] = await db.select({ count: count() }).from(schema.dataImportRuns).where(eq(schema.dataImportRuns.userId, userId));
    assert.equal(memoryCount?.count, 0);
    assert.equal(auditCount?.count, 0);
  } finally {
    await db.delete(schema.dataImportRuns).where(eq(schema.dataImportRuns.userId, userId));
    await db.delete(schema.coreMemories).where(eq(schema.coreMemories.userId, userId));
    await db.delete(schema.diaryEntries).where(eq(schema.diaryEntries.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.end();
  }
});
