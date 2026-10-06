import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { deleteExpiredDataImportRunsBatch } from "../src/domains/import/import-retention.js";
import { lockAndReadMcpIdempotency } from "../src/domains/mcp-write/mcp-write-idempotency.js";
import {
  RETENTION_BATCH_SIZE,
  RETENTION_MAX_BATCHES_PER_RUN,
  runBoundedRetention,
} from "../src/domains/retention/retention-policy.js";
import { deleteExpiredMcpIdempotencyBatch } from "../src/mcp/server/idempotency-retention.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = (() => {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
})();
const localDatabase = parsedDatabaseUrl?.hostname === "127.0.0.1" || parsedDatabaseUrl?.hostname === "localhost";
const enabled = process.env.RUN_DATA_RETENTION_DATABASE_TEST === "1" && Boolean(databaseUrl) && localDatabase;
const skipReason = enabled
  ? false
  : "SKIP: set RUN_DATA_RETENTION_DATABASE_TEST=1 with a DATABASE_URL hosted only at 127.0.0.1 or localhost";

type Database = ReturnType<typeof drizzle<typeof schema>>;

function connect(): { client: ReturnType<typeof postgres>; db: Database } {
  const client = postgres(databaseUrl!, { max: 4, prepare: false, ssl: false });
  return { client, db: drizzle(client, { schema }) };
}

async function insertInChunks<T>(
  db: Database,
  values: readonly T[],
  insert: (chunk: readonly T[], start: number) => Promise<unknown>,
): Promise<void> {
  for (let start = 0; start < values.length; start += RETENTION_BATCH_SIZE) {
    await insert(values.slice(start, start + RETENTION_BATCH_SIZE), start);
  }
}

async function countForUser(
  db: Database,
  table: typeof schema.mcpWriteIdempotency | typeof schema.dataImportRuns,
  userId: string,
): Promise<number> {
  const [result] = await db.select({ value: count() }).from(table).where(eq(table.userId, userId));
  return result?.value ?? 0;
}

// This catches an accidental <= cutoff predicate, unordered/non-bounded deletes,
// a missing SKIP LOCKED race guard, or retention code that reaches canonical data.
test("disposable PostgreSQL retention honors strict boundaries, batching, canonical data, races, and retry", { skip: skipReason }, async () => {
  const { client, db } = connect();
  const userId = randomUUID();
  const cutoff = new Date("2026-08-01T00:00:00.000Z");
  const old = new Date("2026-07-31T23:59:59.999Z");
  const newer = new Date("2026-08-01T00:00:00.001Z");
  const boundaryKeys = {
    old: "retention-boundary-old-0001",
    equal: "retention-boundary-equal-01",
    newer: "retention-boundary-new-00001",
  };

  try {
    await db.insert(schema.users).values({
      id: userId,
      email: `data-retention-${userId}@example.invalid`,
      displayName: "Data retention acceptance fixture",
      status: "active",
    });
    const [diary] = await db.insert(schema.diaryEntries).values({
      userId,
      title: "Retention fixture diary",
      content: "Canonical diary must survive retention.",
      date: "2026-08-01",
      tags: ["retention"],
      source: "chatgpt_mcp",
      author: "L",
      status: "active",
      idempotencyKey: "retention-canonical-diary-1",
      requestHash: "a".repeat(64),
    }).returning({ id: schema.diaryEntries.id });
    const mindId = randomUUID();
    await db.insert(schema.runtimeSubjectStates).values({
      id: mindId,
      userId,
      subjectId: "retention-canonical-subject",
      kind: "memory",
      text: "Canonical Mind state must survive operational retention.",
      payload: { fixture: "retention" },
      scopeApplicability: "global",
      scopeConversationId: null,
      scopePathHeadMessageId: null,
      settlementStatus: "settled",
      pathStatus: "current",
      validityStatus: "valid",
      envelope: { fixture: "retention" },
    });
    await db.insert(schema.toolCalls).values({
      userId,
      toolName: "write_diary",
      operation: "create",
      resourceType: "diary_entry",
      resourceId: diary!.id,
      idempotencyKey: "retention-tool-call-fixture",
      requestSummary: {},
      resultSummary: {},
      durationMs: 1,
      status: "success",
    });
    await db.insert(schema.resourceLifecycleEvents).values({
      userId,
      resourceType: "diary",
      resourceId: diary!.id,
      action: "archive",
      actorType: "user",
      channel: "mcp",
      metadata: {},
    });
    await db.insert(schema.mcpWriteIdempotency).values([
      { userId, toolName: "write_diary", idempotencyKey: boundaryKeys.old, requestHash: "b".repeat(64), resourceType: "diary_entry", resourceId: diary!.id, createdAt: old },
      { userId, toolName: "write_diary", idempotencyKey: boundaryKeys.equal, requestHash: "c".repeat(64), resourceType: "diary_entry", resourceId: diary!.id, createdAt: cutoff },
      { userId, toolName: "write_diary", idempotencyKey: boundaryKeys.newer, requestHash: "d".repeat(64), resourceType: "diary_entry", resourceId: diary!.id, createdAt: newer },
    ]);

    const boundaryRun = await runBoundedRetention((limit) => deleteExpiredMcpIdempotencyBatch(db as never, cutoff, limit));
    assert.deepEqual(boundaryRun, { deletedRows: 1, batches: 1, capped: false });
    const secondBoundaryRun = await runBoundedRetention((limit) => deleteExpiredMcpIdempotencyBatch(db as never, cutoff, limit));
    assert.deepEqual(secondBoundaryRun, { deletedRows: 0, batches: 1, capped: false });
    const boundaryRows = await db.select({ key: schema.mcpWriteIdempotency.idempotencyKey })
      .from(schema.mcpWriteIdempotency)
      .where(and(eq(schema.mcpWriteIdempotency.userId, userId), inArray(schema.mcpWriteIdempotency.idempotencyKey, Object.values(boundaryKeys))));
    assert.deepEqual(boundaryRows.map(({ key }) => key).sort(), [boundaryKeys.equal, boundaryKeys.newer].sort());
    await db.transaction(async (transaction) => {
      const retained = await lockAndReadMcpIdempotency(transaction as never, {
        userId,
        toolName: "write_diary",
        idempotencyKey: boundaryKeys.equal,
      });
      assert.deepEqual(retained, { requestHash: "c".repeat(64), resourceType: "diary_entry", resourceId: diary!.id });
    });
    assert.equal((await db.select({ value: count() }).from(schema.diaryEntries).where(eq(schema.diaryEntries.id, diary!.id)))[0]?.value, 1);
    assert.equal((await db.select({ value: count() }).from(schema.toolCalls).where(eq(schema.toolCalls.userId, userId)))[0]?.value, 1);
    assert.equal((await db.select({ value: count() }).from(schema.resourceLifecycleEvents).where(eq(schema.resourceLifecycleEvents.userId, userId)))[0]?.value, 1);

    const orderedKeys = Array.from({ length: RETENTION_BATCH_SIZE + 1 }, (_, index) => `retention-ordered-${String(index).padStart(5, "0")}`);
    await insertInChunks(db, orderedKeys, async (keys, start) => {
      await db.insert(schema.mcpWriteIdempotency).values(keys.map((idempotencyKey, index) => ({
        userId,
        toolName: "write_diary" as const,
        idempotencyKey,
        requestHash: "e".repeat(64),
        resourceType: "diary_entry" as const,
        resourceId: diary!.id,
        createdAt: new Date(Date.UTC(2026, 6, 1, 0, 0, start + index)),
      })));
    });
    assert.equal(await deleteExpiredMcpIdempotencyBatch(db as never, cutoff, RETENTION_BATCH_SIZE), RETENTION_BATCH_SIZE);
    const orderedRemaining = await db.select({ key: schema.mcpWriteIdempotency.idempotencyKey })
      .from(schema.mcpWriteIdempotency)
      .where(and(eq(schema.mcpWriteIdempotency.userId, userId), inArray(schema.mcpWriteIdempotency.idempotencyKey, orderedKeys)));
    assert.deepEqual(orderedRemaining.map(({ key }) => key), [orderedKeys.at(-1)]);
    await db.delete(schema.mcpWriteIdempotency).where(and(eq(schema.mcpWriteIdempotency.userId, userId), eq(schema.mcpWriteIdempotency.idempotencyKey, orderedKeys.at(-1)!)));

    const cappedKeys = Array.from({ length: RETENTION_BATCH_SIZE * RETENTION_MAX_BATCHES_PER_RUN + 1 }, (_, index) => `retention-capped-${String(index).padStart(5, "0")}`);
    await insertInChunks(db, cappedKeys, async (keys, start) => {
      await db.insert(schema.mcpWriteIdempotency).values(keys.map((idempotencyKey, index) => ({
        userId,
        toolName: "write_diary" as const,
        idempotencyKey,
        requestHash: "f".repeat(64),
        resourceType: "diary_entry" as const,
        resourceId: diary!.id,
        createdAt: new Date(Date.UTC(2026, 6, 2, 0, 0, start + index)),
      })));
    });
    const cappedRun = await runBoundedRetention((limit) => deleteExpiredMcpIdempotencyBatch(db as never, cutoff, limit));
    assert.deepEqual(cappedRun, { deletedRows: 10_000, batches: 20, capped: true });
    const cappedRemaining = await db.select({ key: schema.mcpWriteIdempotency.idempotencyKey })
      .from(schema.mcpWriteIdempotency)
      .where(and(eq(schema.mcpWriteIdempotency.userId, userId), inArray(schema.mcpWriteIdempotency.idempotencyKey, cappedKeys)));
    assert.deepEqual(cappedRemaining.map(({ key }) => key), [cappedKeys.at(-1)]);
    await db.delete(schema.mcpWriteIdempotency).where(and(eq(schema.mcpWriteIdempotency.userId, userId), eq(schema.mcpWriteIdempotency.idempotencyKey, cappedKeys.at(-1)!)));

    await db.insert(schema.dataImportRuns).values([
      { userId, packageSha256: "1".repeat(64), previewFingerprint: "2".repeat(64), schemaVersion: 2, summary: { fixture: "old" }, createdAt: old },
      { userId, packageSha256: "3".repeat(64), previewFingerprint: "4".repeat(64), schemaVersion: 2, summary: { fixture: "equal" }, createdAt: cutoff },
      { userId, packageSha256: "5".repeat(64), previewFingerprint: "6".repeat(64), schemaVersion: 2, summary: { fixture: "new" }, createdAt: newer },
    ]);
    const importRun = await runBoundedRetention((limit) => deleteExpiredDataImportRunsBatch(db as never, cutoff, limit));
    assert.deepEqual(importRun, { deletedRows: 1, batches: 1, capped: false });
    assert.equal(await countForUser(db, schema.dataImportRuns, userId), 2);
    assert.equal((await db.select({ value: count() }).from(schema.runtimeSubjectStates).where(eq(schema.runtimeSubjectStates.id, mindId)))[0]?.value, 1);
    assert.equal((await db.select({ value: count() }).from(schema.diaryEntries).where(eq(schema.diaryEntries.id, diary!.id)))[0]?.value, 1);

    const raceKeys = Array.from({ length: 750 }, (_, index) => `retention-race-${String(index).padStart(5, "0")}`);
    await insertInChunks(db, raceKeys, async (keys, start) => {
      await db.insert(schema.mcpWriteIdempotency).values(keys.map((idempotencyKey, index) => ({
        userId,
        toolName: "write_diary" as const,
        idempotencyKey,
        requestHash: "7".repeat(64),
        resourceType: "diary_entry" as const,
        resourceId: diary!.id,
        createdAt: new Date(Date.UTC(2026, 6, 3, 0, 0, start + index)),
      })));
    });
    const first = connect();
    const second = connect();
    try {
      const outcomes = await Promise.all([
        runBoundedRetention((limit) => deleteExpiredMcpIdempotencyBatch(first.db as never, cutoff, limit)),
        runBoundedRetention((limit) => deleteExpiredMcpIdempotencyBatch(second.db as never, cutoff, limit)),
      ]);
      assert.equal(outcomes[0].deletedRows + outcomes[1].deletedRows, 750);
    } finally {
      await Promise.all([first.client.end(), second.client.end()]);
    }
    assert.equal((await db.select({ value: count() }).from(schema.mcpWriteIdempotency)
      .where(and(eq(schema.mcpWriteIdempotency.userId, userId), inArray(schema.mcpWriteIdempotency.idempotencyKey, raceKeys))))[0]?.value, 0);
    assert.equal((await db.select({ value: count() }).from(schema.diaryEntries).where(eq(schema.diaryEntries.id, diary!.id)))[0]?.value, 1);

    const retryKey = "retention-retry-batch-0001";
    await db.insert(schema.mcpWriteIdempotency).values({
      userId,
      toolName: "write_diary",
      idempotencyKey: retryKey,
      requestHash: "8".repeat(64),
      resourceType: "diary_entry",
      resourceId: diary!.id,
      createdAt: old,
    });
    await assert.rejects(runBoundedRetention(async () => { throw new Error("forced retention batch failure"); }), /forced retention batch failure/);
    assert.equal((await db.select({ value: count() }).from(schema.mcpWriteIdempotency)
      .where(and(eq(schema.mcpWriteIdempotency.userId, userId), eq(schema.mcpWriteIdempotency.idempotencyKey, retryKey))))[0]?.value, 1);
    const retryRun = await runBoundedRetention((limit) => deleteExpiredMcpIdempotencyBatch(db as never, cutoff, limit));
    assert.deepEqual(retryRun, { deletedRows: 1, batches: 1, capped: false });
  } finally {
    try {
      await db.delete(schema.dataImportRuns).where(eq(schema.dataImportRuns.userId, userId));
      await db.delete(schema.mcpWriteIdempotency).where(eq(schema.mcpWriteIdempotency.userId, userId));
      await db.delete(schema.resourceLifecycleEvents).where(eq(schema.resourceLifecycleEvents.userId, userId));
      await db.delete(schema.toolCalls).where(eq(schema.toolCalls.userId, userId));
      await db.delete(schema.runtimeSubjectStates).where(eq(schema.runtimeSubjectStates.userId, userId));
      await db.delete(schema.diaryEntries).where(eq(schema.diaryEntries.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    } finally {
      await client.end();
    }
  }
});
