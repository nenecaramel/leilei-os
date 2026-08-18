import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { deleteExpiredMcpIdempotency } from "../src/mcp/server/idempotency-retention.js";

const databaseUrl = process.env.DATABASE_URL;
const parsed = databaseUrl ? new URL(databaseUrl) : null;
const localTarget = parsed?.hostname === "127.0.0.1" || parsed?.hostname === "localhost";
const RUN = process.env.RUN_MCP_IDEMPOTENCY_RETENTION_DATABASE_TEST === "1" && Boolean(databaseUrl) && localTarget;

test("real PostgreSQL retention deletes only rows older than the cutoff and preserves related data", { skip: !RUN }, async () => {
  const client = postgres(databaseUrl!, { max: 1, prepare: false, ssl: false });
  const db = drizzle(client, { schema });
  const userId = randomUUID();
  const cutoff = new Date("2026-08-01T00:00:00.000Z");
  const oldCreatedAt = new Date("2026-07-31T23:59:59.999Z");
  const equalCreatedAt = cutoff;
  const newCreatedAt = new Date("2026-08-01T00:00:00.001Z");
  const keys = ["retention-old-key", "retention-equal-key", "retention-new-key"];
  try {
    await db.insert(schema.users).values({
      id: userId,
      email: `retention-${userId}@example.invalid`,
      displayName: "Retention integration",
      status: "active",
    });
    const [diary] = await db.insert(schema.diaryEntries).values({
      userId,
      title: "Retention fixture",
      content: "retention fixture content",
      date: "2026-08-01",
      tags: [],
      source: "chatgpt_mcp",
      author: "L",
      status: "active",
      idempotencyKey: "retention-diary-resource",
      requestHash: "a".repeat(64),
    }).returning({ id: schema.diaryEntries.id });
    await db.insert(schema.toolCalls).values({
      userId,
      toolName: "write_diary",
      operation: "create",
      resourceType: "diary_entry",
      resourceId: diary!.id,
      idempotencyKey: "retention-tool-call",
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
      { userId, toolName: "write_diary", idempotencyKey: keys[0]!, requestHash: "b".repeat(64), resourceType: "diary_entry", resourceId: diary!.id, createdAt: oldCreatedAt },
      { userId, toolName: "write_diary", idempotencyKey: keys[1]!, requestHash: "c".repeat(64), resourceType: "diary_entry", resourceId: diary!.id, createdAt: equalCreatedAt },
      { userId, toolName: "write_diary", idempotencyKey: keys[2]!, requestHash: "d".repeat(64), resourceType: "diary_entry", resourceId: diary!.id, createdAt: newCreatedAt },
    ]);

    const deleted = await deleteExpiredMcpIdempotency(db as never, cutoff);
    assert.equal(deleted, 1);
    const remaining = await db.select({ key: schema.mcpWriteIdempotency.idempotencyKey })
      .from(schema.mcpWriteIdempotency)
      .where(and(eq(schema.mcpWriteIdempotency.userId, userId), inArray(schema.mcpWriteIdempotency.idempotencyKey, keys)));
    assert.deepEqual(remaining.map((row) => row.key).sort(), keys.slice(1).sort());
    assert.equal((await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId))).length, 1);
    assert.equal((await db.select({ id: schema.diaryEntries.id }).from(schema.diaryEntries).where(eq(schema.diaryEntries.userId, userId))).length, 1);
    assert.equal((await db.select({ id: schema.toolCalls.id }).from(schema.toolCalls).where(eq(schema.toolCalls.userId, userId))).length, 1);
    assert.equal((await db.select({ id: schema.resourceLifecycleEvents.id }).from(schema.resourceLifecycleEvents).where(eq(schema.resourceLifecycleEvents.userId, userId))).length, 1);
  } finally {
    await db.delete(schema.mcpWriteIdempotency).where(eq(schema.mcpWriteIdempotency.userId, userId));
    await db.delete(schema.resourceLifecycleEvents).where(eq(schema.resourceLifecycleEvents.userId, userId));
    await db.delete(schema.toolCalls).where(eq(schema.toolCalls.userId, userId));
    await db.delete(schema.diaryEntries).where(eq(schema.diaryEntries.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.end();
  }
});
