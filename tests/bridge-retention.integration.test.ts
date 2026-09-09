import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { deleteExpiredBridgeEventsBatch } from "../src/domains/bridge/bridge-retention.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = (() => {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
})();
const localDatabase = ["127.0.0.1", "localhost", "::1"].includes(
  parsedDatabaseUrl?.hostname ?? "",
);
const enabled =
  process.env.RUN_BRIDGE_RETENTION_DATABASE_TEST === "1" &&
  Boolean(databaseUrl) &&
  localDatabase;
const skipReason = enabled
  ? false
  : "SKIP: set RUN_BRIDGE_RETENTION_DATABASE_TEST=1 with a local DATABASE_URL";

type Database = ReturnType<typeof drizzle<typeof schema>>;

function connect(): { client: ReturnType<typeof postgres>; db: Database } {
  const client = postgres(databaseUrl!, { max: 4, prepare: false, ssl: false });
  return { client, db: drizzle(client, { schema }) };
}

function eventValues(
  userId: string,
  id: string,
  suffix: string,
  createdAt: Date,
  status: "host_sent" | "delivery_unknown",
  kind: "chat" | "wake" = "chat",
) {
  return {
    id,
    userId,
    idempotencyKey: `bridge-retention-${suffix}`,
    requestHash: createHash("sha256").update(suffix, "utf8").digest("hex"),
    kind,
    source: kind === "wake" ? ("leileios_sentinel" as const) : ("leileios_pwa" as const),
    visibleText: `retention fixture ${suffix}`,
    modelContext: `retention fixture context ${suffix}`,
    status,
    createdAt,
    hostSentAt: status === "host_sent" ? createdAt : null,
    deliveryUnknownAt: status === "delivery_unknown" ? createdAt : null,
  };
}

async function insertFinalizedWake(
  db: Database,
  userId: string,
  sentinelId: string,
  bridgeEventId: string,
  id: string,
  timestamp: Date,
): Promise<void> {
  await db.insert(schema.sentinelWakeRuns).values({
    id,
    sentinelId,
    userId,
    controlRevision: 0,
    cause: "scheduled",
    scheduledFor: timestamp,
    triggeredAt: timestamp,
    bridgeEventId,
    state: "finalized",
    decision: "quiet",
    nextWakeAt: new Date(timestamp.getTime() + 60 * 60 * 1_000),
    completionPayloadHash: "a".repeat(64),
    claimedAt: timestamp,
    finalizedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

test(
  "Bridge retention preserves Sentinel-referenced terminal events while cleaning eligible unreferenced rows",
  { skip: skipReason },
  async () => {
    const { client, db } = connect();
    const userId = randomUUID();
    const sentinelId = randomUUID();
    const cutoff = new Date("2026-08-01T00:00:00.000Z");
    const old = new Date(cutoff.getTime() - 60_000);
    const recent = new Date("2026-08-01T00:00:00.001Z");
    const ids = {
      oldUnreferenced: randomUUID(),
      oldReferenced: randomUUID(),
      oldLaterUnreferenced: randomUUID(),
      recentReferenced: randomUUID(),
      oldUnknownUnreferenced: randomUUID(),
      oldUnknownReferenced: randomUUID(),
      equalBoundary: randomUUID(),
      batchOne: randomUUID(),
      batchTwo: randomUUID(),
      batchThree: randomUUID(),
    };
    const wakeIds = {
      oldReferenced: randomUUID(),
      recentReferenced: randomUUID(),
      oldUnknownReferenced: randomUUID(),
    };

    try {
      await db.insert(schema.users).values({
        id: userId,
        email: `bridge-retention-${userId}@example.invalid`,
        displayName: "Bridge retention fixture",
        status: "active",
      });
      await db.insert(schema.sentinels).values({
        id: sentinelId,
        userId,
        enabled: false,
        timezone: "Asia/Shanghai",
        policyPrompt: "retention fixture",
        createdAt: old,
        updatedAt: old,
      });
      await db.insert(schema.bridgeEvents).values([
        eventValues(userId, ids.oldUnreferenced, "old-unreferenced", old, "host_sent"),
        eventValues(userId, ids.oldReferenced, "old-referenced", new Date(old.getTime() + 1_000), "host_sent", "wake"),
        eventValues(userId, ids.oldLaterUnreferenced, "old-later-unreferenced", new Date(old.getTime() + 2_000), "host_sent"),
        eventValues(userId, ids.recentReferenced, "recent-referenced", recent, "host_sent", "wake"),
        eventValues(userId, ids.oldUnknownUnreferenced, "old-unknown-unreferenced", new Date(old.getTime() + 3_000), "delivery_unknown"),
        eventValues(userId, ids.oldUnknownReferenced, "old-unknown-referenced", new Date(old.getTime() + 4_000), "delivery_unknown", "wake"),
        eventValues(userId, ids.equalBoundary, "equal-boundary", cutoff, "host_sent"),
        eventValues(userId, ids.batchOne, "batch-one", new Date(old.getTime() + 5_000), "host_sent"),
        eventValues(userId, ids.batchTwo, "batch-two", new Date(old.getTime() + 6_000), "host_sent"),
        eventValues(userId, ids.batchThree, "batch-three", new Date(old.getTime() + 7_000), "host_sent"),
      ]);
      await insertFinalizedWake(db, userId, sentinelId, ids.oldReferenced, wakeIds.oldReferenced, old);
      await insertFinalizedWake(db, userId, sentinelId, ids.recentReferenced, wakeIds.recentReferenced, recent);
      await insertFinalizedWake(db, userId, sentinelId, ids.oldUnknownReferenced, wakeIds.oldUnknownReferenced, old);

      const beforeRows = await db
        .select({
          status: schema.bridgeEvents.status,
          hostSentAt: schema.bridgeEvents.hostSentAt,
          deliveryUnknownAt: schema.bridgeEvents.deliveryUnknownAt,
        })
        .from(schema.bridgeEvents)
        .where(eq(schema.bridgeEvents.userId, userId));
      assert.equal(beforeRows.length, 10);
      assert.equal(
        beforeRows.filter(
          (row) =>
            (row.status === "host_sent" && row.hostSentAt && row.hostSentAt < cutoff) ||
            (row.status === "delivery_unknown" && row.deliveryUnknownAt && row.deliveryUnknownAt < cutoff),
        ).length,
        8,
      );

      // The referenced row sorts between two eligible rows. A bounded batch must
      // skip it so the later unreferenced row can still be deleted.
      assert.equal(
        await deleteExpiredBridgeEventsBatch(db as never, cutoff, 2),
        2,
      );
      assert.equal(
        (await db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, ids.oldUnreferenced))).length,
        0,
      );
      assert.equal(
        (await db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, ids.oldLaterUnreferenced))).length,
        0,
      );
      assert.equal(
        (await db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, ids.oldReferenced))).length,
        1,
      );
      assert.equal(
        (await db.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.id, wakeIds.oldReferenced))).length,
        1,
      );

      // Referenced delivery_unknown rows are retained; unreferenced ones remain
      // eligible under the existing terminal-state contract.
      assert.equal(await deleteExpiredBridgeEventsBatch(db as never, cutoff, 1), 1);
      assert.equal(
        (await db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, ids.oldUnknownReferenced))).length,
        1,
      );
      assert.equal(
        (await db.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.id, wakeIds.oldUnknownReferenced))).length,
        1,
      );

      // The batch limit remains enforced for unreferenced rows, while the recent
      // and exact-boundary events remain untouched.
      assert.equal(await deleteExpiredBridgeEventsBatch(db as never, cutoff, 2), 2);
      assert.equal(await deleteExpiredBridgeEventsBatch(db as never, cutoff, 2), 1);
      assert.equal(
        await deleteExpiredBridgeEventsBatch(db as never, cutoff, 2),
        0,
      );
      assert.equal(
        (await db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, ids.batchThree))).length,
        1,
      );
      assert.equal(
        (await db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, ids.recentReferenced))).length,
        1,
      );
      assert.equal(
        (await db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, ids.equalBoundary))).length,
        1,
      );
      assert.equal(
        (await db.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.id, wakeIds.recentReferenced))).length,
        1,
      );
    } finally {
      await db.delete(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.userId, userId));
      await db.delete(schema.bridgeEvents).where(eq(schema.bridgeEvents.userId, userId));
      await db.delete(schema.sentinels).where(eq(schema.sentinels.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
      await client.end();
    }
  },
);
