import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleSentinelRepository } from "../src/domains/sentinel/sentinel-repository.js";
import { SentinelService } from "../src/domains/sentinel/sentinel-service.js";

const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const localDatabase = target?.hostname === "127.0.0.1" || target?.hostname === "localhost" || target?.hostname === "::1";
const enabled = process.env.RUN_SENTINEL_DATABASE_TEST === "1" && Boolean(databaseUrl) && localDatabase;
const skipReason = enabled ? false : "SKIP: set RUN_SENTINEL_DATABASE_TEST=1 with a local PostgreSQL DATABASE_URL";

test(
  "owner-scoped Sentinel controls persist hard-stop, fresh resume schedules, no-overlap wake-now, and recovery",
  { skip: skipReason },
  async () => {
    const client = postgres(databaseUrl!, { max: 8, prepare: false, ssl: false });
    const db = drizzle(client, { schema });
    const ownerId = randomUUID();
    const otherUserId = randomUUID();
    let sentinelId = "";
    try {
      const createdAt = new Date("2026-08-30T00:00:00.000Z");
      await db.insert(schema.users).values([
        { id: ownerId, email: `sentinel-controls-owner-${ownerId}@example.invalid`, displayName: "Owner", status: "active", createdAt, updatedAt: createdAt },
        { id: otherUserId, email: `sentinel-controls-other-${otherUserId}@example.invalid`, displayName: "Other", status: "active", createdAt, updatedAt: createdAt },
      ]);
      const repository = new DrizzleSentinelRepository(db as never);
      const service = new SentinelService(repository);
      const initial = await service.ensureSentinel(ownerId, { timezone: "Asia/Shanghai", policyPrompt: "bounded" });
      sentinelId = initial.id;
      assert.equal(initial.enabled, false);
      assert.equal(initial.activeWakeRunId, null);

      const firstImmediate = await service.resumeNow(ownerId);
      assert.equal(firstImmediate.outcome, "applied");
      assert.ok(firstImmediate.wake);
      const firstWakeId = firstImmediate.wake!.id;
      const [enabledSentinel] = await db.select().from(schema.sentinels).where(eq(schema.sentinels.id, sentinelId));
      assert.equal(enabledSentinel?.enabled, true);
      assert.equal(enabledSentinel?.activeWakeRunId, firstWakeId);
      assert.equal(enabledSentinel?.nextWakeAt, null);

      const overlapping = await service.wakeNow(ownerId);
      assert.deepEqual(overlapping, { outcome: "conflict" });
      const paused = await service.pause(ownerId);
      assert.equal(paused.outcome, "applied");
      assert.equal(paused.sentinel.enabled, false);
      assert.equal(paused.sentinel.nextWakeAt, null);
      assert.equal(paused.sentinel.activeWakeRunId, null);
      const [superseded] = await db.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.id, firstWakeId));
      assert.equal(superseded?.state, "superseded");
      await assert.rejects(service.getWakeState(ownerId, firstWakeId));
      await assert.rejects(service.getWakeState(otherUserId, firstWakeId));

      const resumed = await service.resume(ownerId, new Date(Date.now() + 10 * 60 * 1_000));
      assert.equal(resumed.outcome, "applied");
      assert.equal(resumed.sentinel.enabled, true);
      assert.ok(resumed.sentinel.nextWakeAt);
      assert.ok(resumed.sentinel.nextWakeAt!.getTime() > Date.now());
      assert.equal(resumed.sentinel.activeWakeRunId, null);
      const resumedSchedule = resumed.sentinel.nextWakeAt!.getTime();
      const pausedDue = new Date(resumedSchedule - 20 * 60 * 1_000);
      await db.update(schema.sentinels).set({ enabled: false, nextWakeAt: pausedDue }).where(eq(schema.sentinels.id, sentinelId));
      const freshResume = await service.resume(ownerId, new Date(Date.now() + 15 * 60 * 1_000));
      assert.equal(freshResume.outcome, "applied");
      assert.ok(freshResume.sentinel.nextWakeAt!.getTime() > pausedDue.getTime());

      const wakeNow = await service.wakeNow(ownerId);
      assert.equal(wakeNow.outcome, "applied");
      assert.ok(wakeNow.wake);
      const activeWakeId = wakeNow.wake!.id;
      await db.update(schema.sentinelWakeRuns).set({ state: "recovery_required", failureCode: "WAKE_FINALIZATION_TIMEOUT" }).where(eq(schema.sentinelWakeRuns.id, activeWakeId));
      const recovered = await service.recover(ownerId);
      assert.equal(recovered.outcome, "applied");
      assert.equal(recovered.previousWake?.id, activeWakeId);
      assert.equal(recovered.previousWake?.state, "recovery_required");
      assert.equal(recovered.wake?.cause, "recovery");
      assert.notEqual(recovered.wake?.id, activeWakeId);
      const repeatedRecovery = await service.recover(ownerId);
      assert.deepEqual(repeatedRecovery, { outcome: "conflict" });
      const wakeRows = await db.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.sentinelId, sentinelId));
      assert.equal(wakeRows.filter((wake) => wake.cause === "recovery").length, 1);
      assert.equal(wakeRows.find((wake) => wake.id === activeWakeId)?.state, "superseded");

      const unknownWakeId = recovered.wake!.id;
      const unknownBridgeId = recovered.wake!.bridgeEventId;
      const dispatchStartedAt = new Date("2026-08-30T00:30:00.000Z");
      await db.update(schema.bridgeEvents)
        .set({
          status: "delivery_unknown",
          dispatchStartedAt,
          deliveryUnknownAt: dispatchStartedAt,
          processingState: "unclaimed",
        })
        .where(eq(schema.bridgeEvents.id, unknownBridgeId));
      const [beforeUnknownBridge] = await db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, unknownBridgeId));
      const unknownRecovery = await service.recover(ownerId);
      assert.equal(unknownRecovery.outcome, "applied");
      assert.equal(unknownRecovery.previousWake?.id, unknownWakeId);
      assert.equal(unknownRecovery.previousWake?.state, "bridge_enqueued");
      assert.equal(unknownRecovery.wake?.cause, "recovery");
      const [afterUnknownBridge] = await db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, unknownBridgeId));
      assert.deepEqual(
        {
          status: afterUnknownBridge?.status,
          dispatchStartedAt: afterUnknownBridge?.dispatchStartedAt,
          deliveryUnknownAt: afterUnknownBridge?.deliveryUnknownAt,
          processingState: afterUnknownBridge?.processingState,
          cancelledAt: afterUnknownBridge?.cancelledAt,
        },
        {
          status: beforeUnknownBridge?.status,
          dispatchStartedAt: beforeUnknownBridge?.dispatchStartedAt,
          deliveryUnknownAt: beforeUnknownBridge?.deliveryUnknownAt,
          processingState: beforeUnknownBridge?.processingState,
          cancelledAt: beforeUnknownBridge?.cancelledAt,
        },
      );
      const recoveryActivity = await service.listWakeActivity(ownerId, 10);
      assert.equal(recoveryActivity.find((wake) => wake.id === unknownWakeId)?.recoveryRequired, true);
      assert.ok((await service.listWakeActivity(ownerId, 2)).length <= 2);
    } finally {
      if (sentinelId) await db.delete(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.sentinelId, sentinelId));
      await db.delete(schema.bridgeEvents).where(eq(schema.bridgeEvents.userId, ownerId));
      await db.delete(schema.sentinels).where(eq(schema.sentinels.userId, ownerId));
      await db.delete(schema.users).where(eq(schema.users.id, ownerId));
      await db.delete(schema.users).where(eq(schema.users.id, otherUserId));
      await client.end();
    }
  },
);
