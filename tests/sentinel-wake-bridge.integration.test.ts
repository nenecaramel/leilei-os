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
          const sentinelService = new SentinelService(sentinelRepository, { createId: () => "wake-1" });
          const bridgeService = new BridgeService(bridgeRepository, { createId: () => randomUUID(), now: () => now });
          const sentinel = await sentinelRepository.createSentinel({ userId: owner, timezone: "UTC", policyPrompt: "" });
          await transaction.update(schema.sentinels).set({ enabled: true, nextWakeAt: new Date(now.getTime() - 1_000) }).where(eq(schema.sentinels.id, sentinel.id));

          const created = await sentinelService.enqueueWake(owner, {
            cause: "scheduled",
            scheduledFor: new Date(now.getTime() - 1_000),
            wakeId: "wake-1",
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
            wakeId: "wake-1",
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
          const secondService = new SentinelService(sentinelRepository, { createId: () => "wake-2" });
          const secondWake = await secondService.enqueueWake(secondOwner, { cause: "wake_now", scheduledFor: now, wakeId: "wake-2" });
          assert.equal(secondWake.outcome, "created");
          const cancelled = await sentinelService.cancelWakeBeforeDispatch(secondOwner, "wake-2");
          assert.equal(cancelled.outcome, "cancelled");
          assert.equal(cancelled.bridge.cancelledAt instanceof Date, true);
          assert.equal(await bridgeRepository.acquireListenerLease(secondOwner, secondListener).then((r) => r.state), "acquired");
          assert.equal(await bridgeRepository.reserveNext(secondOwner, secondListener), null);

          const thirdOwner = randomUUID();
          await transaction.insert(schema.users).values({ id: thirdOwner, email: `wake-owner-${thirdOwner}@example.invalid`, displayName: "Wake third", status: "active", createdAt: now, updatedAt: now });
          const thirdSentinel = await sentinelRepository.createSentinel({ userId: thirdOwner, timezone: "UTC", policyPrompt: "" });
          const thirdService = new SentinelService(sentinelRepository, { createId: () => "wake-3" });
          const thirdWake = await thirdService.enqueueWake(thirdOwner, { cause: "wake_now", scheduledFor: now, wakeId: "wake-3" });
          assert.equal(thirdWake.outcome, "created");
          assert.equal((await bridgeRepository.acquireListenerLease(thirdOwner, secondListener)).state, "acquired");
          assert.equal((await bridgeRepository.reserveNext(thirdOwner, secondListener))?.id, thirdWake.bridge.id);
          await bridgeRepository.markDispatchStarted(thirdOwner, secondListener, thirdWake.bridge.id);
          const lateCancel = await sentinelService.cancelWakeBeforeDispatch(thirdOwner, "wake-3");
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

