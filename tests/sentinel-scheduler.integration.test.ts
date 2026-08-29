import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleSentinelRepository } from "../src/domains/sentinel/sentinel-repository.js";
import {
  SENTINEL_WAKE_RECOVERY_TIMEOUT_MS,
  createSentinelScheduler,
} from "../src/domains/sentinel/sentinel-scheduler.js";

const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const localTarget = target?.hostname === "127.0.0.1" || target?.hostname === "localhost";
const RUN = process.env.RUN_SENTINEL_DATABASE_TEST === "1" && Boolean(databaseUrl) && localTarget;

function connection() {
  const client = postgres(databaseUrl!, { max: 4, prepare: false, ssl: false });
  return { client, db: drizzle(client, { schema }) };
}

test(
  "two PostgreSQL-backed schedulers race safely, survive restart, retain one pending wake, and project stale claims",
  { skip: RUN ? false : "SKIP: set RUN_SENTINEL_DATABASE_TEST=1 with a local DATABASE_URL" },
  async () => {
    const admin = connection();
    const workerA = connection();
    const workerB = connection();
    const owner = randomUUID();
    const now = new Date("2026-08-30T00:00:00.000Z");
    let sentinelId = "";
    try {
      await admin.db.insert(schema.users).values({
        id: owner,
        email: `sentinel-scheduler-${owner}@example.invalid`,
        displayName: "Scheduler owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const adminRepository = new DrizzleSentinelRepository(admin.db as never);
      const created = await adminRepository.createSentinel({
        userId: owner,
        timezone: "UTC",
        policyPrompt: "",
      });
      sentinelId = created.id;
      const schedulerA = createSentinelScheduler({
        repository: new DrizzleSentinelRepository(workerA.db as never),
        createWakeId: randomUUID,
      });
      const schedulerB = createSentinelScheduler({
        repository: new DrizzleSentinelRepository(workerB.db as never),
        createWakeId: randomUUID,
      });
      // Disabled or not-yet-due Sentinels are not eligible for a wake.
      assert.equal(await schedulerA.runOnce(now), 0);
      await admin.db
        .update(schema.sentinels)
        .set({ enabled: true, nextWakeAt: new Date(now.getTime() + 60_000) })
        .where(eq(schema.sentinels.id, created.id));
      assert.equal(await schedulerA.runOnce(now), 0);
      await admin.db
        .update(schema.sentinels)
        .set({ enabled: true, nextWakeAt: new Date(now.getTime() - 1_000) })
        .where(eq(schema.sentinels.id, created.id));
      const race = await Promise.all([schedulerA.runOnce(now), schedulerB.runOnce(now)]);
      assert.deepEqual(race.sort(), [0, 1]);

      const [sentinelAfterRace] = await admin.db
        .select()
        .from(schema.sentinels)
        .where(eq(schema.sentinels.id, created.id));
      const wakeRows = await admin.db
        .select()
        .from(schema.sentinelWakeRuns)
        .where(eq(schema.sentinelWakeRuns.sentinelId, created.id));
      const bridgeRows = await admin.db
        .select()
        .from(schema.bridgeEvents)
        .where(eq(schema.bridgeEvents.userId, owner));
      assert.equal(wakeRows.length, 1);
      assert.equal(bridgeRows.length, 1);
      assert.equal(sentinelAfterRace?.activeWakeRunId, wakeRows[0]?.id);
      assert.equal(sentinelAfterRace?.nextWakeAt, null);
      assert.equal(bridgeRows[0]?.status, "pending");

      // A fresh scheduler instance observes durable state after a restart and cannot enqueue a successor.
      const afterRestart = createSentinelScheduler({
        repository: new DrizzleSentinelRepository(workerA.db as never),
        createWakeId: randomUUID,
      });
      assert.equal(await afterRestart.runOnce(new Date(now.getTime() + 30_000)), 0);
      const [persistedAfterRestart] = await admin.db
        .select()
        .from(schema.sentinels)
        .where(eq(schema.sentinels.id, created.id));
      assert.equal(persistedAfterRestart?.activeWakeRunId, wakeRows[0]?.id);

      // Mark the one active run as stale/claimed; projection must not create a successor.
      const staleClaimedAt = new Date(now.getTime() - SENTINEL_WAKE_RECOVERY_TIMEOUT_MS - 1_000);
      await admin.db
        .update(schema.sentinelWakeRuns)
        .set({ state: "claimed", claimedAt: staleClaimedAt })
        .where(eq(schema.sentinelWakeRuns.id, wakeRows[0]!.id));
      assert.equal(await afterRestart.runOnce(now), 0);
      const [recovered] = await admin.db
        .select()
        .from(schema.sentinelWakeRuns)
        .where(eq(schema.sentinelWakeRuns.id, wakeRows[0]!.id));
      assert.equal(recovered?.state, "recovery_required");
      assert.equal(
        (await admin.db.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.sentinelId, created.id))).length,
        1,
      );

      // Listener absence is represented by the still-pending Bridge event, never by a duplicate wake.
      assert.equal(bridgeRows[0]?.status, "pending");
    } finally {
      await admin.db.delete(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.sentinelId, sentinelId));
      await admin.db.delete(schema.bridgeEvents).where(eq(schema.bridgeEvents.userId, owner));
      await admin.db.delete(schema.sentinels).where(eq(schema.sentinels.userId, owner));
      await admin.db.delete(schema.users).where(eq(schema.users.id, owner));
      await Promise.all([admin.client.end(), workerA.client.end(), workerB.client.end()]);
    }
  },
);
