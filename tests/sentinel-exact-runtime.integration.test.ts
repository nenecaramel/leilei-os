import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleBridgeEventRepository } from "../src/domains/bridge/bridge-event-repository.js";
import { BridgeService } from "../src/domains/bridge/bridge-service.js";
import { DrizzleSentinelRepository } from "../src/domains/sentinel/sentinel-repository.js";
import {
  SENTINEL_WAKE_RECOVERY_TIMEOUT_MS,
  createSentinelScheduler,
} from "../src/domains/sentinel/sentinel-scheduler.js";
import { SentinelDomainError, SentinelService } from "../src/domains/sentinel/sentinel-service.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseTarget = (() => {
  if (!databaseUrl) return null;
  try { return new URL(databaseUrl); } catch { return null; }
})();
const localDatabase = databaseTarget?.hostname === "127.0.0.1"
  || databaseTarget?.hostname === "localhost"
  || databaseTarget?.hostname === "::1";
const RUN = process.env.RUN_SENTINEL_DATABASE_TEST === "1" && Boolean(databaseUrl) && localDatabase;
const skipReason = RUN ? false : "SKIP: set RUN_SENTINEL_DATABASE_TEST=1 with a local PostgreSQL DATABASE_URL";

function connection(max = 6) {
  const client = postgres(databaseUrl!, { max, prepare: false, ssl: false });
  return { client, db: drizzle(client, { schema }) };
}

async function insertOwner(db: ReturnType<typeof connection>["db"], ownerId: string, label: string): Promise<void> {
  await db.insert(schema.users).values({
    id: ownerId,
    email: `sentinel-exact-${label}-${ownerId}@example.invalid`,
    displayName: `Sentinel ${label}`,
    status: "active",
  });
}

async function cleanupOwner(db: ReturnType<typeof connection>["db"], ownerId: string): Promise<void> {
  await db.delete(schema.bridgeListenerLeases).where(eq(schema.bridgeListenerLeases.userId, ownerId));
  await db.delete(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.userId, ownerId));
  await db.delete(schema.bridgeEvents).where(eq(schema.bridgeEvents.userId, ownerId));
  await db.delete(schema.sentinels).where(eq(schema.sentinels.userId, ownerId));
  await db.delete(schema.users).where(eq(schema.users.id, ownerId));
}

test("exact runtime keeps scheduler scans, restart, listener return, and human priority single-owner durable", { skip: skipReason }, async () => {
  const admin = connection();
  const workerA = connection();
  const workerB = connection();
  const ownerId = randomUUID();
  const listenerId = randomUUID();
  try {
    await insertOwner(admin.db, ownerId, "scheduler");
    const repository = new DrizzleSentinelRepository(admin.db as never);
    const sentinel = await repository.createSentinel({
      userId: ownerId,
      timezone: "Asia/Shanghai",
      policyPrompt: "exact runtime policy",
    });
    assert.equal(sentinel.enabled, false);
    await admin.db.update(schema.sentinels).set({
      enabled: true,
      nextWakeAt: sql`CURRENT_TIMESTAMP - interval '1 second'`,
    }).where(eq(schema.sentinels.id, sentinel.id));

    const schedulerA = createSentinelScheduler({
      repository: new DrizzleSentinelRepository(workerA.db as never),
      createWakeId: randomUUID,
    });
    const schedulerB = createSentinelScheduler({
      repository: new DrizzleSentinelRepository(workerB.db as never),
      createWakeId: randomUUID,
    });
    await Promise.all([schedulerA.runOnce(), schedulerA.runOnce(), schedulerB.runOnce()]);

    const wakeRows = await admin.db.select().from(schema.sentinelWakeRuns)
      .where(eq(schema.sentinelWakeRuns.userId, ownerId));
    const bridgeRows = await admin.db.select().from(schema.bridgeEvents)
      .where(eq(schema.bridgeEvents.userId, ownerId));
    assert.equal(wakeRows.length, 1);
    assert.equal(bridgeRows.length, 1);
    assert.equal(bridgeRows[0]?.status, "pending");
    assert.equal(bridgeRows[0]?.processingState, "unclaimed");
    const activeWakeId = wakeRows[0]!.id;
    const activeBridgeId = bridgeRows[0]!.id;

    const restartedScheduler = createSentinelScheduler({
      repository: new DrizzleSentinelRepository(workerB.db as never),
      createWakeId: randomUUID,
    });
    assert.equal(await restartedScheduler.runOnce(), 0);
    assert.equal(
      (await admin.db.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.userId, ownerId))).length,
      1,
    );

    const bridgeRepository = new DrizzleBridgeEventRepository(admin.db as never);
    const bridgeService = new BridgeService(bridgeRepository);
    await bridgeService.createPwaEvent(ownerId, "human first", `human-priority-${randomUUID()}`);
    assert.equal((await bridgeRepository.acquireListenerLease(ownerId, listenerId)).state, "acquired");
    const human = await bridgeRepository.reserveNext(ownerId, listenerId);
    assert.equal(human?.kind, "chat");
    await bridgeRepository.markHostSent(ownerId, listenerId, human!.id);
    const continuedWake = await bridgeRepository.reserveNext(ownerId, listenerId);
    assert.equal(continuedWake?.id, activeBridgeId);
    assert.equal(continuedWake?.source, "leileios_sentinel");
    assert.equal(wakeRows[0]?.id, activeWakeId);

    // A human event arriving after the wake reservation but before dispatch
    // forces that wake to yield without changing its durable Wake Run.
    await bridgeService.createPwaEvent(ownerId, "human at dispatch boundary", `human-boundary-${randomUUID()}`);
    assert.equal(await bridgeRepository.markDispatchStarted(ownerId, listenerId, activeBridgeId), null);
    const yieldedWake = await bridgeRepository.getEvent(ownerId, activeBridgeId);
    assert.equal(yieldedWake?.status, "pending");
    assert.equal(yieldedWake?.dispatchStartedAt, null);
    assert.equal(yieldedWake?.retryCount, 0);
    const boundaryHuman = await bridgeRepository.reserveNext(ownerId, listenerId);
    assert.equal(boundaryHuman?.kind, "chat");
    await bridgeRepository.markHostSent(ownerId, listenerId, boundaryHuman!.id);
    assert.equal((await bridgeRepository.reserveNext(ownerId, listenerId))?.id, activeBridgeId);
    assert.equal(
      (await admin.db.select().from(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.userId, ownerId))).length,
      1,
    );
  } finally {
    await cleanupOwner(admin.db, ownerId);
    await Promise.all([admin.client.end(), workerA.client.end(), workerB.client.end()]);
  }
});

test("exact runtime preserves pause boundaries, stale suppression, no-overlap controls, and explicit recovery", { skip: skipReason }, async () => {
  const admin = connection();
  const owners = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  try {
    for (const [index, ownerId] of owners.entries()) await insertOwner(admin.db, ownerId, `controls-${index}`);
    const repository = new DrizzleSentinelRepository(admin.db as never);
    const bridgeRepository = new DrizzleBridgeEventRepository(admin.db as never);

    // Definitely pre-dispatch Pause cancels Bridge work and makes it ineligible.
    const preService = new SentinelService(repository);
    await preService.ensureSentinel(owners[0]!, { timezone: "Asia/Shanghai", policyPrompt: "pre" });
    const pre = await preService.resumeNow(owners[0]!);
    assert.equal(pre.outcome, "applied");
    if (!("wake" in pre) || !pre.wake) throw new Error("pre-dispatch wake missing");
    const preBridge = (await admin.db.select().from(schema.bridgeEvents)
      .where(eq(schema.bridgeEvents.id, pre.wake.bridgeEventId)))[0]!;
    const prePaused = await preService.pause(owners[0]!);
    assert.equal(prePaused.outcome, "applied");
    const preBridgeAfter = (await admin.db.select().from(schema.bridgeEvents)
      .where(eq(schema.bridgeEvents.id, preBridge.id)))[0]!;
    const preWakeAfter = (await admin.db.select().from(schema.sentinelWakeRuns)
      .where(eq(schema.sentinelWakeRuns.id, pre.wake.id)))[0]!;
    assert.equal(preBridgeAfter.cancelledAt instanceof Date, true);
    assert.equal(preBridgeAfter.dispatchStartedAt, null);
    assert.equal(preWakeAfter.state, "superseded");
    const missedWhilePaused = new Date(Date.now() - 60_000);
    await admin.db.update(schema.sentinels).set({ nextWakeAt: missedWhilePaused })
      .where(eq(schema.sentinels.userId, owners[0]!));
    const resumedFuture = new Date(Date.now() + 25 * 60_000);
    const freshResume = await preService.resume(owners[0]!, resumedFuture);
    assert.equal(freshResume.outcome, "applied");
    assert.equal("sentinel" in freshResume ? freshResume.sentinel.nextWakeAt?.getTime() : null, resumedFuture.getTime());

    // Post-dispatch Pause preserves transport evidence; late finalization cannot move the fresh schedule.
    const postService = new SentinelService(repository);
    await postService.ensureSentinel(owners[1]!, { timezone: "Asia/Shanghai", policyPrompt: "post" });
    const post = await postService.resumeNow(owners[1]!);
    if (!("wake" in post) || !post.wake) throw new Error("post-dispatch wake missing");
    const postListener = randomUUID();
    assert.equal((await bridgeRepository.acquireListenerLease(owners[1]!, postListener)).state, "acquired");
    const postReserved = await bridgeRepository.reserveNext(owners[1]!, postListener);
    assert.equal(postReserved?.id, post.wake.bridgeEventId);
    await bridgeRepository.markDispatchStarted(owners[1]!, postListener, post.wake.bridgeEventId);
    assert.equal((await bridgeRepository.claimProcessing(owners[1]!, post.wake.bridgeEventId)).outcome, "applied");
    const transportBeforePause = await bridgeRepository.getEvent(owners[1]!, post.wake.bridgeEventId);
    assert.equal((await postService.pause(owners[1]!)).outcome, "applied");
    const transportAfterPause = await bridgeRepository.getEvent(owners[1]!, post.wake.bridgeEventId);
    assert.deepEqual({
      status: transportAfterPause?.status,
      dispatchStartedAt: transportAfterPause?.dispatchStartedAt,
      processingState: transportAfterPause?.processingState,
      modelClaimedAt: transportAfterPause?.modelClaimedAt,
      cancelledAt: transportAfterPause?.cancelledAt,
    }, {
      status: transportBeforePause?.status,
      dispatchStartedAt: transportBeforePause?.dispatchStartedAt,
      processingState: transportBeforePause?.processingState,
      modelClaimedAt: transportBeforePause?.modelClaimedAt,
      cancelledAt: transportBeforePause?.cancelledAt,
    });
    const freshSchedule = new Date(Date.now() + 20 * 60_000);
    assert.equal((await postService.resume(owners[1]!, freshSchedule)).outcome, "applied");
    await assert.rejects(
      postService.completeWake(owners[1]!, {
        wakeId: post.wake.id,
        decision: "contact",
        nextWakeAt: new Date(Date.now() + 30 * 60_000),
        contextCapsule: "late stale capsule",
      }),
      (error: unknown) => error instanceof SentinelDomainError && error.code === "SENTINEL_WAKE_CONFLICT",
    );
    assert.equal((await repository.findByUserId(owners[1]!))?.nextWakeAt?.getTime(), freshSchedule.getTime());

    // Resume-now and Wake-now use one active pointer and refuse overlap.
    await postService.pause(owners[1]!);
    const resumedNow = await postService.resumeNow(owners[1]!);
    assert.equal(resumedNow.outcome, "applied");
    assert.equal((await postService.wakeNow(owners[1]!)).outcome, "conflict");

    // delivery_unknown + unclaimed remains quarantined and needs one explicit recovery successor.
    const unknownService = new SentinelService(repository);
    await unknownService.ensureSentinel(owners[2]!, { timezone: "Asia/Shanghai", policyPrompt: "unknown" });
    const unknown = await unknownService.resumeNow(owners[2]!);
    if (!("wake" in unknown) || !unknown.wake) throw new Error("unknown wake missing");
    const unknownListener = randomUUID();
    await bridgeRepository.acquireListenerLease(owners[2]!, unknownListener);
    assert.equal((await bridgeRepository.reserveNext(owners[2]!, unknownListener))?.id, unknown.wake.bridgeEventId);
    await bridgeRepository.markDispatchStarted(owners[2]!, unknownListener, unknown.wake.bridgeEventId);
    await bridgeRepository.markDeliveryUnknown(owners[2]!, unknownListener, unknown.wake.bridgeEventId, "UI_MESSAGE_AMBIGUOUS");
    assert.equal(await bridgeRepository.reserveNext(owners[2]!, unknownListener), null);
    const quarantined = await bridgeRepository.getEvent(owners[2]!, unknown.wake.bridgeEventId);
    assert.equal(quarantined?.status, "delivery_unknown");
    assert.equal(quarantined?.processingState, "unclaimed");
    assert.equal(quarantined?.retryCount, 0);
    assert.equal((await unknownService.listWakeActivity(owners[2]!, 10))[0]?.recoveryRequired, true);
    const recovered = await unknownService.recover(owners[2]!);
    assert.equal(recovered.outcome, "applied");
    if (!("wake" in recovered) || !recovered.wake) throw new Error("recovery successor missing");
    assert.equal(recovered.wake.cause, "recovery");
    assert.equal((await admin.db.select().from(schema.sentinelWakeRuns)
      .where(eq(schema.sentinelWakeRuns.id, unknown.wake.id)))[0]?.state, "superseded");
    assert.equal((await unknownService.recover(owners[2]!)).outcome, "conflict");
    assert.equal((await admin.db.select().from(schema.sentinelWakeRuns)
      .where(and(eq(schema.sentinelWakeRuns.userId, owners[2]!), eq(schema.sentinelWakeRuns.cause, "recovery")))).length, 1);
    assert.equal((await bridgeRepository.getEvent(owners[2]!, unknown.wake.bridgeEventId))?.status, "delivery_unknown");

    // A claimed wake older than 15 minutes is projected only; scheduler never creates its successor.
    const staleService = new SentinelService(repository);
    await staleService.ensureSentinel(owners[3]!, { timezone: "Asia/Shanghai", policyPrompt: "stale" });
    const stale = await staleService.resumeNow(owners[3]!);
    if (!("wake" in stale) || !stale.wake) throw new Error("stale wake missing");
    const staleListener = randomUUID();
    await bridgeRepository.acquireListenerLease(owners[3]!, staleListener);
    await bridgeRepository.reserveNext(owners[3]!, staleListener);
    await bridgeRepository.markDispatchStarted(owners[3]!, staleListener, stale.wake.bridgeEventId);
    await bridgeRepository.claimProcessing(owners[3]!, stale.wake.bridgeEventId);
    await admin.db.update(schema.sentinelWakeRuns).set({
      claimedAt: sql`CURRENT_TIMESTAMP - interval '16 minutes'`,
    }).where(eq(schema.sentinelWakeRuns.id, stale.wake.id));
    const beforeScanCount = (await admin.db.select().from(schema.sentinelWakeRuns)
      .where(eq(schema.sentinelWakeRuns.userId, owners[3]!))).length;
    await createSentinelScheduler({ repository, createWakeId: randomUUID }).runOnce();
    const staleAfter = (await admin.db.select().from(schema.sentinelWakeRuns)
      .where(eq(schema.sentinelWakeRuns.id, stale.wake.id)))[0]!;
    assert.equal(staleAfter.state, "recovery_required");
    assert.equal((await admin.db.select().from(schema.sentinelWakeRuns)
      .where(eq(schema.sentinelWakeRuns.userId, owners[3]!))).length, beforeScanCount);
  } finally {
    for (const ownerId of owners) await cleanupOwner(admin.db, ownerId);
    await admin.client.end();
  }
});

test("exact runtime finalization is owner-safe, DB-time bounded, hash-idempotent, and invariant-preserving", { skip: skipReason }, async () => {
  const admin = connection();
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  try {
    await insertOwner(admin.db, ownerId, "finalize");
    await insertOwner(admin.db, otherOwnerId, "other");
    const repository = new DrizzleSentinelRepository(admin.db as never);
    const bridgeRepository = new DrizzleBridgeEventRepository(admin.db as never);
    const service = new SentinelService(repository);
    const sentinel = await service.ensureSentinel(ownerId, {
      timezone: "Asia/Shanghai",
      policyPrompt: "finalization policy",
    });
    const resumed = await service.resumeNow(ownerId);
    if (!("wake" in resumed) || !resumed.wake) throw new Error("finalization wake missing");
    const wakeId = resumed.wake.id;
    const bridgeId = resumed.wake.bridgeEventId;
    const listenerId = randomUUID();
    await bridgeRepository.acquireListenerLease(ownerId, listenerId);
    await bridgeRepository.reserveNext(ownerId, listenerId);
    await bridgeRepository.markDispatchStarted(ownerId, listenerId, bridgeId);
    const firstClaim = await bridgeRepository.claimProcessing(ownerId, bridgeId);
    const duplicateClaim = await bridgeRepository.claimProcessing(ownerId, bridgeId);
    assert.equal(firstClaim.outcome, "applied");
    assert.equal(duplicateClaim.outcome, "idempotent");
    assert.equal(firstClaim.event.modelClaimedAt?.getTime(), duplicateClaim.event.modelClaimedAt?.getTime());
    const claimedWake = (await admin.db.select().from(schema.sentinelWakeRuns)
      .where(eq(schema.sentinelWakeRuns.id, wakeId)))[0]!;
    assert.equal(claimedWake.claimedAt?.getTime(), firstClaim.event.modelClaimedAt?.getTime());

    await assert.rejects(service.getWakeState(otherOwnerId, wakeId));
    assert.equal(await repository.findByUserId(randomUUID()), null);
    await assert.rejects(
      service.completeWake(otherOwnerId, {
        wakeId,
        decision: "quiet",
        nextWakeAt: new Date(Date.now() + 10 * 60_000),
        contextCapsule: "foreign",
      }),
      (error: unknown) => error instanceof SentinelDomainError && error.code === "SENTINEL_WAKE_NOT_FOUND",
    );
    await assert.rejects(
      service.completeWake(ownerId, {
        wakeId,
        decision: "quiet",
        nextWakeAt: new Date(Date.now() + 60_000),
        contextCapsule: "too soon",
      }),
      (error: unknown) => error instanceof SentinelDomainError && error.code === "NEXT_WAKE_TOO_SOON",
    );
    await assert.rejects(
      service.completeWake(ownerId, {
        wakeId,
        decision: "quiet",
        nextWakeAt: new Date(Date.now() + 8 * 24 * 60 * 60_000),
        contextCapsule: "too far",
      }),
      (error: unknown) => error instanceof SentinelDomainError && error.code === "NEXT_WAKE_TOO_FAR",
    );

    const nextWakeAt = new Date(Date.now() + 20 * 60_000);
    const applied = await service.completeWake(ownerId, {
      wakeId,
      decision: "quiet",
      nextWakeAt,
      contextCapsule: " e\u0301 ",
    });
    assert.equal(applied.outcome, "applied");
    const replay = await service.completeWake(ownerId, {
      wakeId,
      decision: "quiet",
      nextWakeAt,
      contextCapsule: "é",
    });
    assert.equal(replay.outcome, "idempotent");
    assert.equal(replay.wake.completionPayloadHash, applied.wake.completionPayloadHash);
    await admin.db.update(schema.sentinels).set({ wakeContextCapsule: "newer-cycle-capsule" })
      .where(eq(schema.sentinels.id, sentinel.id));
    await assert.rejects(
      service.completeWake(ownerId, {
        wakeId,
        decision: "contact",
        nextWakeAt,
        contextCapsule: "é",
      }),
      (error: unknown) => error instanceof SentinelDomainError && error.code === "SENTINEL_WAKE_CONFLICT",
    );

    const [storedSentinel] = await admin.db.select().from(schema.sentinels)
      .where(eq(schema.sentinels.id, sentinel.id));
    const [storedWake] = await admin.db.select().from(schema.sentinelWakeRuns)
      .where(eq(schema.sentinelWakeRuns.id, wakeId));
    const [storedBridge] = await admin.db.select().from(schema.bridgeEvents)
      .where(eq(schema.bridgeEvents.id, bridgeId));
    assert.equal(storedSentinel?.activeWakeRunId, null);
    assert.equal(storedSentinel?.nextWakeAt?.getTime(), nextWakeAt.getTime());
    assert.equal(storedWake?.state, "finalized");
    assert.equal(storedWake?.decision, "quiet");
    assert.equal(storedWake?.nextWakeAt?.getTime(), nextWakeAt.getTime());
    assert.equal(storedWake?.finalizedAt instanceof Date, true);
    assert.equal(storedWake?.completionPayloadHash?.length, 64);
    assert.equal(storedBridge?.processingState, "completed");
    assert.equal(storedBridge?.modelCompletedAt instanceof Date, true);
    assert.equal(storedSentinel?.lastValidWakeAt?.getTime(), storedWake?.finalizedAt?.getTime());

    // The database rejects contradictory active/schedule and finalization shapes.
    await assert.rejects(admin.db.transaction(async (transaction) => {
      await transaction.update(schema.sentinels).set({
        activeWakeRunId: randomUUID(),
        nextWakeAt: new Date(Date.now() + 60 * 60_000),
      }).where(eq(schema.sentinels.id, sentinel.id));
    }));
    await assert.rejects(admin.db.transaction(async (transaction) => {
      await transaction.update(schema.sentinelWakeRuns).set({
        state: "finalized",
        decision: null,
        nextWakeAt: null,
        finalizedAt: null,
        completionPayloadHash: null,
      }).where(eq(schema.sentinelWakeRuns.id, wakeId));
    }));
    await assert.rejects(admin.db.transaction(async (transaction) => {
      await transaction.update(schema.sentinelWakeRuns).set({
        state: "superseded",
        decision: "quiet",
      }).where(eq(schema.sentinelWakeRuns.id, wakeId));
    }));
  } finally {
    await cleanupOwner(admin.db, ownerId);
    await cleanupOwner(admin.db, otherOwnerId);
    await admin.client.end();
  }
});
