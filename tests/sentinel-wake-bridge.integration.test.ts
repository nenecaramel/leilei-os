import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleBridgeEventRepository } from "../src/domains/bridge/bridge-event-repository.js";
import { BridgeService } from "../src/domains/bridge/bridge-service.js";
import { DrizzleSentinelRepository } from "../src/domains/sentinel/sentinel-repository.js";
import { SentinelService } from "../src/domains/sentinel/sentinel-service.js";

const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const localTarget = target?.hostname === "127.0.0.1" || target?.hostname === "localhost";
const RUN = process.env.RUN_BRIDGE_DATABASE_TEST === "1" && Boolean(databaseUrl) && localTarget;

class RollbackWakeTest extends Error {}

function connection() {
  const client = postgres(databaseUrl!, { max: 4, prepare: false, ssl: false });
  return { client, db: drizzle(client, { schema }) };
}

test(
  "real PostgreSQL wake orchestration is atomic, priority-aware, cancellable before dispatch, and claim-synchronized",
  { skip: RUN ? false : "SKIP: set RUN_BRIDGE_DATABASE_TEST=1 with a local DATABASE_URL" },
  async () => {
    const admin = connection();
    const owner = randomUUID();
    const secondOwner = randomUUID();
    const listener = randomUUID();
    const secondListener = randomUUID();
    const now = new Date("2026-08-29T00:00:00.000Z");
    try {
      await assert.rejects(
        admin.db.transaction(async (transaction) => {
          await transaction.insert(schema.users).values([
            { id: owner, email: `wake-owner-${owner}@example.invalid`, displayName: "Wake owner", status: "active", createdAt: now, updatedAt: now },
            { id: secondOwner, email: `wake-owner-${secondOwner}@example.invalid`, displayName: "Wake other", status: "active", createdAt: now, updatedAt: now },
          ]);
          const sentinelRepository = new DrizzleSentinelRepository(transaction as never);
          const bridgeRepository = new DrizzleBridgeEventRepository(transaction as never);
          const wakeId = randomUUID();
          const sentinelService = new SentinelService(sentinelRepository, { createId: () => wakeId });
          const bridgeService = new BridgeService(bridgeRepository, { createId: () => randomUUID(), now: () => now });
          const sentinel = await sentinelRepository.createSentinel({ userId: owner, timezone: "UTC", policyPrompt: "" });
          await transaction.update(schema.sentinels).set({ enabled: true, nextWakeAt: new Date(now.getTime() - 1_000) }).where(eq(schema.sentinels.id, sentinel.id));

          const created = await sentinelService.enqueueWake(owner, {
            cause: "scheduled",
            scheduledFor: new Date(now.getTime() - 1_000),
            wakeId,
          });
          assert.equal(created.outcome, "created");
          assert.equal(created.wake.state, "bridge_enqueued");
          assert.equal(created.bridge.kind, "wake");
          assert.equal(created.bridge.source, "leileios_sentinel");
          assert.equal(created.bridge.visibleText, "[LeileiOS Sentinel wake]");
          const ownerState = await sentinelRepository.findByUserId(owner);
          assert.equal(ownerState?.activeWakeRunId, created.wake.id);
          assert.equal(ownerState?.nextWakeAt, null);

          const replay = await sentinelService.enqueueWake(owner, {
            cause: "scheduled",
            scheduledFor: new Date(now.getTime() - 1_000),
            wakeId,
          });
          assert.equal(replay.outcome, "idempotent");
          assert.equal(replay.bridge.idempotencyKey, created.bridge.idempotencyKey);

          // Human work always reserves ahead of an older Sentinel wake.
          await bridgeService.createPwaEvent(owner, "human", "human-event-key-0001");
          assert.equal((await bridgeRepository.acquireListenerLease(owner, listener)).state, "acquired");
          const human = await bridgeRepository.reserveNext(owner, listener);
          assert.equal(human?.kind, "chat");
          await bridgeRepository.markHostSent(owner, listener, human!.id);
          const wake = await bridgeRepository.reserveNext(owner, listener);
          assert.equal(wake?.id, created.bridge.id);
          assert.equal(await bridgeRepository.markDispatchStarted(owner, listener, wake!.id).then(Boolean), true);
          const claimed = await bridgeRepository.claimProcessing(owner, wake!.id);
          assert.equal(claimed.outcome, "applied");
          const wakeAfterClaim = await transaction.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.id, created.wake.id));
          assert.equal(wakeAfterClaim[0]?.state, "claimed");
          assert.equal(wakeAfterClaim[0]?.claimedAt?.getTime(), claimed.event.modelClaimedAt?.getTime());
          const duplicateClaim = await bridgeRepository.claimProcessing(owner, wake!.id);
          assert.equal(duplicateClaim.outcome, "idempotent");
          const wakeAfterDuplicate = await transaction.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.id, created.wake.id));
          assert.equal(wakeAfterDuplicate[0]?.claimedAt?.getTime(), wakeAfterClaim[0]?.claimedAt?.getTime());

          // A second owner exercises pre-dispatch cancellation and post-dispatch refusal.
          const secondSentinel = await sentinelRepository.createSentinel({ userId: secondOwner, timezone: "UTC", policyPrompt: "" });
          const secondWakeId = randomUUID();
          const secondService = new SentinelService(sentinelRepository, { createId: () => secondWakeId });
          const secondWake = await secondService.enqueueWake(secondOwner, { cause: "wake_now", scheduledFor: now, wakeId: secondWakeId });
          assert.equal(secondWake.outcome, "created");
          assert.equal((await bridgeRepository.acquireListenerLease(secondOwner, secondListener)).state, "acquired");
          const reservedBeforeCancel = await bridgeRepository.reserveNext(secondOwner, secondListener);
          assert.equal(reservedBeforeCancel?.id, secondWake.bridge.id);
          assert.equal(reservedBeforeCancel?.dispatchStartedAt, null);
          const cancelled = await sentinelService.cancelWakeBeforeDispatch(secondOwner, secondWakeId);
          assert.equal(cancelled.outcome, "cancelled");
          assert.equal(cancelled.bridge.cancelledAt instanceof Date, true);
          assert.equal(await bridgeRepository.reserveNext(secondOwner, secondListener), null);

          const thirdOwner = randomUUID();
          await transaction.insert(schema.users).values({ id: thirdOwner, email: `wake-owner-${thirdOwner}@example.invalid`, displayName: "Wake third", status: "active", createdAt: now, updatedAt: now });
          const thirdSentinel = await sentinelRepository.createSentinel({ userId: thirdOwner, timezone: "UTC", policyPrompt: "" });
          const thirdWakeId = randomUUID();
          const thirdService = new SentinelService(sentinelRepository, { createId: () => thirdWakeId });
          const thirdWake = await thirdService.enqueueWake(thirdOwner, { cause: "wake_now", scheduledFor: now, wakeId: thirdWakeId });
          assert.equal(thirdWake.outcome, "created");
          assert.equal((await bridgeRepository.acquireListenerLease(thirdOwner, secondListener)).state, "acquired");
          assert.equal((await bridgeRepository.reserveNext(thirdOwner, secondListener))?.id, thirdWake.bridge.id);
          await bridgeRepository.markDispatchStarted(thirdOwner, secondListener, thirdWake.bridge.id);
          const lateCancel = await sentinelService.cancelWakeBeforeDispatch(thirdOwner, thirdWakeId);
          assert.equal(lateCancel.outcome, "conflict");
          const preserved = await bridgeRepository.getEvent(thirdOwner, thirdWake.bridge.id);
          assert.equal(preserved?.cancelledAt, null);

          throw new RollbackWakeTest();
        }),
        (error: unknown) => error instanceof RollbackWakeTest,
      );
    } finally {
      await admin.client.end();
    }
  },
);

test(
  "concurrent independent claims apply once and synchronize Wake Run timestamps",
  { skip: RUN ? false : "SKIP: set RUN_BRIDGE_DATABASE_TEST=1 with a local DATABASE_URL" },
  async () => {
    const admin = connection();
    const clientA = connection();
    const clientB = connection();
    const owner = randomUUID();
    const listener = randomUUID();
    const wakeId = randomUUID();
    const now = new Date("2026-08-29T02:00:00.000Z");
    try {
      const sentinelRepository = new DrizzleSentinelRepository(admin.db as never);
      const repositoryA = new DrizzleBridgeEventRepository(clientA.db as never);
      const repositoryB = new DrizzleBridgeEventRepository(clientB.db as never);
      await admin.db.insert(schema.users).values({
        id: owner,
        email: `wake-concurrency-${owner}@example.invalid`,
        displayName: "Wake concurrency",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const sentinel = await sentinelRepository.createSentinel({
        userId: owner,
        timezone: "UTC",
        policyPrompt: "",
      });
      await admin.db
        .update(schema.sentinels)
        .set({ enabled: true, nextWakeAt: new Date(now.getTime() - 1_000) })
        .where(eq(schema.sentinels.id, sentinel.id));

      const service = new SentinelService(sentinelRepository);
      const enqueued = await service.enqueueWake(owner, {
        cause: "scheduled",
        scheduledFor: new Date(now.getTime() - 1_000),
        wakeId,
      });
      assert.equal(enqueued.outcome, "created");
      assert.equal((await repositoryA.acquireListenerLease(owner, listener)).state, "acquired");
      assert.equal((await repositoryA.reserveNext(owner, listener))?.id, enqueued.bridge.id);
      await repositoryA.markDispatchStarted(owner, listener, enqueued.bridge.id);

      const results = await Promise.all([
        repositoryA.claimProcessing(owner, enqueued.bridge.id),
        repositoryB.claimProcessing(owner, enqueued.bridge.id),
      ]);
      assert.deepEqual(
        results.map((result) => result.outcome).sort(),
        ["applied", "idempotent"],
      );
      const applied = results.find((result) => result.outcome === "applied");
      const claimedAt = applied?.event.modelClaimedAt;
      assert.equal(claimedAt instanceof Date, true);
      assert.equal(results.every((result) => result.event.modelClaimedAt?.getTime() === claimedAt?.getTime()), true);

      const bridge = await repositoryB.getEvent(owner, enqueued.bridge.id);
      const [wake] = await admin.db
        .select()
        .from(schema.sentinelWakeRuns)
        .where(eq(schema.sentinelWakeRuns.id, wakeId));
      assert.equal(bridge?.processingState, "claimed");
      assert.equal(bridge?.modelClaimedAt instanceof Date, true);
      assert.equal(wake?.state, "claimed");
      assert.equal(wake?.claimedAt instanceof Date, true);
      assert.equal(wake?.claimedAt?.getTime(), bridge?.modelClaimedAt?.getTime());

      const duplicate = await repositoryA.claimProcessing(owner, enqueued.bridge.id);
      assert.equal(duplicate.outcome, "idempotent");
      assert.equal(duplicate.event.modelClaimedAt?.getTime(), claimedAt?.getTime());
      const [wakeAfterDuplicate] = await admin.db
        .select()
        .from(schema.sentinelWakeRuns)
        .where(eq(schema.sentinelWakeRuns.id, wakeId));
      assert.equal(wakeAfterDuplicate?.claimedAt?.getTime(), wake?.claimedAt?.getTime());
    } finally {
      await admin.db.delete(schema.bridgeListenerLeases).where(eq(schema.bridgeListenerLeases.userId, owner));
      await admin.db.delete(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.id, wakeId));
      await admin.db.delete(schema.bridgeEvents).where(eq(schema.bridgeEvents.userId, owner));
      await admin.db.delete(schema.sentinels).where(eq(schema.sentinels.userId, owner));
      await admin.db.delete(schema.users).where(eq(schema.users.id, owner));
      await Promise.all([admin.client.end(), clientA.client.end(), clientB.client.end()]);
    }
  },
);
