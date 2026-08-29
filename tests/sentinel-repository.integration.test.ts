import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleSentinelRepository } from "../src/domains/sentinel/sentinel-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = (() => {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
})();
const localDatabase =
  parsedDatabaseUrl?.hostname === "127.0.0.1" ||
  parsedDatabaseUrl?.hostname === "localhost" ||
  parsedDatabaseUrl?.hostname === "::1";
const enabled =
  process.env.RUN_SENTINEL_DATABASE_TEST === "1" &&
  Boolean(databaseUrl) &&
  localDatabase;
const skipReason = enabled
  ? false
  : "SKIP: set RUN_SENTINEL_DATABASE_TEST=1 with a local DATABASE_URL";

class RollbackSentinelTest extends Error {}

test(
  "real Sentinel repository enforces owner isolation, revision CAS, active-run uniqueness, and Date readback",
  { skip: skipReason },
  async () => {
    const client = postgres(databaseUrl!, { max: 8, prepare: false, ssl: false });
    const db = drizzle(client, { schema });
    try {
      await assert.rejects(
        db.transaction(async (transaction) => {
          const ownerId = randomUUID();
          const otherUserId = randomUUID();
          const timestamp = new Date("2026-08-29T00:00:00.000Z");
          await transaction.insert(schema.users).values([
            {
              id: ownerId,
              email: `sentinel-owner-${ownerId}@example.invalid`,
              displayName: "Sentinel owner",
              status: "active",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            {
              id: otherUserId,
              email: `sentinel-other-${otherUserId}@example.invalid`,
              displayName: "Sentinel other",
              status: "active",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]);

          const repository = new DrizzleSentinelRepository(transaction as never);
          const created = await repository.createSentinel({
            userId: ownerId,
            timezone: "Asia/Shanghai",
            policyPrompt: "bounded policy",
          });
          assert.equal(created.enabled, false);
          assert.equal(created.nextWakeAt, null);
          assert.ok(created.createdAt instanceof Date);
          assert.ok(created.updatedAt instanceof Date);

          await assert.rejects(
            transaction.transaction(async (nested) => {
              await new DrizzleSentinelRepository(nested as never).createSentinel({
                userId: ownerId,
                timezone: "UTC",
                policyPrompt: "second row must be rejected",
              });
            }),
          );

          const ownerRead = await repository.findByUserId(ownerId);
          assert.equal(ownerRead?.userId, ownerId);
          assert.equal(await repository.findByUserId(otherUserId), null);

          const updated = await repository.compareAndAdvanceRevision({
            userId: ownerId,
            expectedRevision: 0,
          });
          assert.equal(updated.outcome, "applied");
          assert.equal(updated.sentinel?.controlRevision, 1);
          const stale = await repository.compareAndAdvanceRevision({
            userId: ownerId,
            expectedRevision: 0,
          });
          assert.deepEqual(stale, { outcome: "conflict" });

          const bridgeEventIds = [randomUUID(), randomUUID()];
          await transaction.insert(schema.bridgeEvents).values(
            bridgeEventIds.map((id, index) => ({
              id,
              userId: ownerId,
              idempotencyKey: `sentinel-test-event-${index.toString().padStart(2, "0")}`,
              requestHash: `${index + 1}`.repeat(64).slice(0, 64),
              kind: "wake" as const,
              source: "leileios_sentinel" as const,
              visibleText: "[LeileiOS Sentinel wake]",
              modelContext: "bounded test context",
              createdAt: timestamp,
            })),
          );

          const firstRun = await repository.createWakeRun({
            sentinelId: created.id,
            userId: ownerId,
            controlRevision: 1,
            cause: "scheduled",
            scheduledFor: timestamp,
            bridgeEventId: bridgeEventIds[0]!,
          });
          assert.ok(firstRun.triggeredAt instanceof Date);
          assert.ok(firstRun.createdAt instanceof Date);
          assert.equal(firstRun.state, "bridge_enqueued");

          await assert.rejects(
            repository.createWakeRun({
              sentinelId: created.id,
              userId: ownerId,
              controlRevision: 1,
              cause: "wake_now",
              scheduledFor: timestamp,
              bridgeEventId: bridgeEventIds[1]!,
            }),
          );

          throw new RollbackSentinelTest();
        }),
        (error: unknown) => error instanceof RollbackSentinelTest,
      );
    } finally {
      await client.end();
    }
  },
);
