import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import {
  DrizzleBridgeEventRepository,
  type BridgeEventCreateInput,
} from "../src/domains/bridge/bridge-event-repository.js";

const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const localTarget = target?.hostname === "127.0.0.1" || target?.hostname === "localhost";
const RUN = process.env.RUN_BRIDGE_DATABASE_TEST === "1" && Boolean(databaseUrl) && localTarget;

const requestHash = (suffix: string) =>
  createHash("sha256").update(suffix, "utf8").digest("hex");
const idempotencyKey = (suffix: string) => `bridge-event-key-${suffix}`.padEnd(16, "x");

function createInput(
  id: string,
  suffix: string,
  createdAt = new Date(),
): BridgeEventCreateInput {
  return {
    id,
    idempotencyKey: idempotencyKey(suffix),
    requestHash: requestHash(suffix),
    kind: "chat",
    source: "leileios_pwa",
    visibleText: `message ${suffix}`,
    modelContext: `context ${suffix}`,
    createdAt,
  };
}

function connection() {
  const client = postgres(databaseUrl!, { max: 1, prepare: false, ssl: false });
  return {
    client,
    db: drizzle(client, { schema }),
  };
}

async function setReservation(
  db: ReturnType<typeof connection>["db"],
  eventId: string,
  listenerId: string,
  expiresAt: Date,
  dispatchStartedAt: Date | null,
) {
  await db
    .update(schema.bridgeEvents)
    .set({
      status: "reserved",
      reservedBy: listenerId,
      reservedAt: new Date(expiresAt.getTime() - 10_000),
      reservationExpiresAt: expiresAt,
      dispatchStartedAt,
    })
    .where(eq(schema.bridgeEvents.id, eventId));
}

test(
  "real PostgreSQL Bridge repository atomically preserves idempotency, leases, FIFO, stale reconciliation, terminality, and owner isolation",
  { skip: !RUN },
  async () => {
    const admin = connection();
    const clientA = connection();
    const clientB = connection();
    const owner = randomUUID();
    const other = randomUUID();
    const queueOwner = randomUUID();
    const ownerListener = randomUUID();
    const secondListener = randomUUID();
    const queueListener = randomUUID();
    const repositoryA = new DrizzleBridgeEventRepository(clientA.db as never);
    const repositoryB = new DrizzleBridgeEventRepository(clientB.db as never);

    try {
      await admin.db.insert(schema.users).values([
        { id: owner, email: `bridge-owner-${owner}@example.invalid`, displayName: "Bridge owner", status: "active" },
        { id: other, email: `bridge-other-${other}@example.invalid`, displayName: "Bridge other", status: "active" },
        { id: queueOwner, email: `bridge-queue-${queueOwner}@example.invalid`, displayName: "Bridge queue", status: "active" },
      ]);

      const idempotentId = randomUUID();
      const idempotentInput = createInput(idempotentId, "idempotent");
      const firstCreate = await repositoryA.createEvent(owner, idempotentInput);
      assert.equal(firstCreate.outcome, "created");
      const replay = await repositoryA.createEvent(owner, idempotentInput);
      assert.equal(replay.outcome, "replayed");
      assert.equal(replay.event.id, idempotentId);

      const conflict = await repositoryA.createEvent(owner, {
        ...idempotentInput,
        id: randomUUID(),
        requestHash: requestHash("different"),
      });
      assert.deepEqual(conflict, { outcome: "conflict" });

      const otherCreate = await repositoryA.createEvent(other, {
        ...idempotentInput,
        id: randomUUID(),
      });
      assert.equal(otherCreate.outcome, "created");
      assert.notEqual(otherCreate.event.id, idempotentId);

      assert.equal((await repositoryA.acquireListenerLease(owner, ownerListener)).state, "acquired");
      assert.equal((await repositoryA.acquireListenerLease(owner, ownerListener)).state, "renewed");
      assert.equal((await repositoryA.acquireListenerLease(owner, secondListener)).state, "busy");
      await admin.db
        .update(schema.bridgeListenerLeases)
        .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
        .where(eq(schema.bridgeListenerLeases.userId, owner));
      assert.equal((await repositoryA.acquireListenerLease(owner, secondListener)).state, "acquired");

      // One pending row can only be reserved once, even with two simultaneous callers.
      assert.equal((await repositoryA.acquireListenerLease(queueOwner, queueListener)).state, "acquired");
      const onlyId = randomUUID();
      await repositoryA.createEvent(queueOwner, createInput(onlyId, "only"));
      const concurrent = await Promise.all([
        repositoryA.reserveNext(queueOwner, queueListener),
        repositoryB.reserveNext(queueOwner, queueListener),
      ]);
      assert.equal(concurrent.filter(Boolean).length, 1);
      const reservedEvent = concurrent.find(Boolean);
      assert.equal(reservedEvent?.id, onlyId);
      assert.equal(reservedEvent?.status, "reserved");
      assert.equal(reservedEvent?.reservedBy, queueListener);
      assert.equal(reservedEvent?.createdAt instanceof Date, true);
      assert.equal(reservedEvent?.reservedAt instanceof Date, true);
      assert.equal(reservedEvent?.reservationExpiresAt instanceof Date, true);
      await repositoryA.markHostSent(queueOwner, queueListener, onlyId);

      // FIFO applies to the oldest currently eligible pending row.
      const oldId = randomUUID();
      const newId = randomUUID();
      await repositoryA.createEvent(
        queueOwner,
        createInput(oldId, "fifo-old", new Date(Date.now() - 2_000)),
      );
      await repositoryA.createEvent(
        queueOwner,
        createInput(newId, "fifo-new", new Date(Date.now() - 1_000)),
      );
      assert.equal((await repositoryA.reserveNext(queueOwner, queueListener))?.id, oldId);
      await repositoryA.markHostSent(queueOwner, queueListener, oldId);
      assert.equal((await repositoryA.reserveNext(queueOwner, queueListener))?.id, newId);
      await repositoryA.markHostSent(queueOwner, queueListener, newId);

      // Human PWA work always remains ahead of an older Sentinel wake.
      const sentinelWakeId = randomUUID();
      const humanPriorityId = randomUUID();
      await admin.db.insert(schema.bridgeEvents).values({
        id: sentinelWakeId,
        userId: queueOwner,
        idempotencyKey: idempotencyKey("sentinel-priority"),
        requestHash: requestHash("sentinel-priority"),
        kind: "wake",
        source: "leileios_sentinel",
        visibleText: "[LeileiOS Sentinel wake]",
        modelContext: "bounded wake context",
        status: "pending",
        createdAt: new Date(Date.now() - 10_000),
      });
      await repositoryA.createEvent(queueOwner, createInput(humanPriorityId, "human-priority"));
      assert.equal((await repositoryA.reserveNext(queueOwner, queueListener))?.id, humanPriorityId);
      await repositoryA.markHostSent(queueOwner, queueListener, humanPriorityId);
      assert.equal((await repositoryA.reserveNext(queueOwner, queueListener))?.id, sentinelWakeId);
      await repositoryA.markHostSent(queueOwner, queueListener, sentinelWakeId);

      // An expired reservation before host dispatch is safely reclaimed.
      const reclaimableId = randomUUID();
      await repositoryA.createEvent(queueOwner, createInput(reclaimableId, "reclaimable"));
      await setReservation(admin.db, reclaimableId, queueListener, new Date(Date.now() - 1_000), null);
      const reclaimed = await repositoryA.reserveNext(queueOwner, queueListener);
      assert.equal(reclaimed?.id, reclaimableId);
      await repositoryA.markHostSent(queueOwner, queueListener, reclaimableId);

      // An expired reservation after pre-dispatch is quarantined and never redispatched.
      const uncertainId = randomUUID();
      await repositoryA.createEvent(queueOwner, createInput(uncertainId, "uncertain"));
      await setReservation(
        admin.db,
        uncertainId,
        queueListener,
        new Date(Date.now() - 1_000),
        new Date(Date.now() - 2_000),
      );
      assert.equal(await repositoryA.reserveNext(queueOwner, queueListener), null);
      const uncertain = await repositoryA.getEvent(queueOwner, uncertainId);
      assert.equal(uncertain?.status, "delivery_unknown");
      assert.equal(uncertain?.deliveryUnknownAt instanceof Date, true);

      // Every lifecycle callback predicates on both owner and listener identity.
      const ownedId = randomUUID();
      await repositoryA.createEvent(queueOwner, createInput(ownedId, "owned"));
      assert.equal((await repositoryA.reserveNext(queueOwner, queueListener))?.id, ownedId);
      assert.equal(await repositoryA.markDispatchStarted(queueOwner, secondListener, ownedId), null);
      assert.equal(await repositoryA.markHostSent(queueOwner, secondListener, ownedId), null);
      assert.equal(await repositoryA.markDeliveryUnknown(queueOwner, secondListener, ownedId, "HOST_TIMEOUT"), null);
      assert.equal(await repositoryA.release(queueOwner, secondListener, ownedId, "HOST_REJECTED"), null);
      assert.equal((await repositoryA.getEvent(queueOwner, ownedId))?.status, "reserved");

      // Definite release is idempotent and clears dispatch state, without a second retry increment.
      assert.equal((await repositoryA.markDispatchStarted(queueOwner, queueListener, ownedId))?.status, "reserved");
      const released = await repositoryA.release(queueOwner, queueListener, ownedId, "HOST_REJECTED");
      assert.equal(released?.status, "pending");
      assert.equal(released?.dispatchStartedAt, null);
      assert.equal(released?.reservedBy, null);
      assert.equal(released?.retryCount, 1);
      await repositoryA.release(queueOwner, queueListener, ownedId, "HOST_REJECTED");
      const releasedAgain = await repositoryA.getEvent(queueOwner, ownedId);
      assert.equal(releasedAgain?.status, "pending");
      assert.equal(releasedAgain?.retryCount, 1);

      // Terminal callbacks are idempotent and terminal states cannot regress.
      const sent = await repositoryA.reserveNext(queueOwner, queueListener);
      assert.equal(sent?.id, ownedId);
      assert.equal((await repositoryA.markHostSent(queueOwner, queueListener, ownedId))?.status, "host_sent");
      assert.equal((await repositoryA.markHostSent(queueOwner, queueListener, ownedId))?.status, "host_sent");
      assert.equal(await repositoryA.release(queueOwner, queueListener, ownedId, "HOST_REJECTED"), null);
      assert.equal(await repositoryA.markDeliveryUnknown(queueOwner, queueListener, ownedId, "HOST_TIMEOUT"), null);
      assert.equal((await repositoryA.getEvent(queueOwner, ownedId))?.status, "host_sent");

      const unknownTerminalId = randomUUID();
      await repositoryA.createEvent(queueOwner, createInput(unknownTerminalId, "unknown-terminal"));
      assert.equal((await repositoryA.reserveNext(queueOwner, queueListener))?.id, unknownTerminalId);
      assert.equal((await repositoryA.markDeliveryUnknown(queueOwner, queueListener, unknownTerminalId, "HOST_TIMEOUT"))?.status, "delivery_unknown");
      assert.equal((await repositoryA.markDeliveryUnknown(queueOwner, queueListener, unknownTerminalId, "HOST_TIMEOUT"))?.status, "delivery_unknown");
      assert.equal(await repositoryA.release(queueOwner, queueListener, unknownTerminalId, "HOST_REJECTED"), null);
      assert.equal((await repositoryA.getEvent(queueOwner, unknownTerminalId))?.status, "delivery_unknown");

      assert.equal(await repositoryA.getEvent(other, idempotentId), null);
      assert.equal((await repositoryA.getEvent(owner, idempotentId))?.id, idempotentId);
    } finally {
      await admin.db.delete(schema.bridgeListenerLeases).where(
        and(
          eq(schema.bridgeListenerLeases.userId, owner),
        ),
      );
      await admin.db.delete(schema.bridgeListenerLeases).where(
        and(
          eq(schema.bridgeListenerLeases.userId, other),
        ),
      );
      await admin.db.delete(schema.bridgeListenerLeases).where(
        and(
          eq(schema.bridgeListenerLeases.userId, queueOwner),
        ),
      );
      for (const userId of [owner, other, queueOwner]) {
        await admin.db.delete(schema.bridgeEvents).where(eq(schema.bridgeEvents.userId, userId));
        await admin.db.delete(schema.users).where(eq(schema.users.id, userId));
      }
      await Promise.all([admin.client.end(), clientA.client.end(), clientB.client.end()]);
    }
  },
);

test(
  "real PostgreSQL Bridge processing transitions are owner-scoped and reconciliation-aware",
  { skip: !RUN },
  async () => {
    const admin = connection();
    const owner = randomUUID();
    const other = randomUUID();
    const listener = randomUUID();
    try {
      await admin.db.insert(schema.users).values([
        { id: owner, email: `bridge-processing-${owner}@example.invalid`, displayName: "Bridge owner", status: "active" },
        { id: other, email: `bridge-processing-${other}@example.invalid`, displayName: "Bridge other", status: "active" },
      ]);
      const repository = new DrizzleBridgeEventRepository(admin.db as never);
      const eventId = randomUUID();
      const created = await repository.createEvent(owner, createInput(eventId, "processing"));
      assert.equal(created.outcome, "created");
      assert.equal(created.event.processingState, "unclaimed");
      assert.equal(created.event.modelClaimedAt, null);
      assert.equal(created.event.modelCompletedAt, null);
      assert.equal(created.event.deliveryReconciledAt, null);

      const pendingClaim = await repository.claimProcessing(owner, eventId);
      assert.deepEqual(pendingClaim, { outcome: "conflict" });
      assert.equal((await repository.getEvent(owner, eventId))?.processingState, "unclaimed");

      assert.equal((await repository.acquireListenerLease(owner, listener)).state, "acquired");
      const reserved = await repository.reserveNext(owner, listener);
      assert.equal(reserved?.id, eventId);
      const preDispatchClaim = await repository.claimProcessing(owner, eventId);
      assert.deepEqual(preDispatchClaim, { outcome: "conflict" });

      assert.equal((await repository.markDispatchStarted(owner, listener, eventId))?.id, eventId);
      const claimed = await repository.claimProcessing(owner, eventId);
      assert.equal(claimed.outcome, "applied");
      assert.equal(claimed.event.processingState, "claimed");
      assert.equal(claimed.event.modelClaimedAt instanceof Date, true);
      assert.equal(claimed.event.modelCompletedAt, null);
      assert.equal(claimed.event.status, "reserved");
      const claimTime = claimed.event.modelClaimedAt;
      const duplicateClaim = await repository.claimProcessing(owner, eventId);
      assert.equal(duplicateClaim.outcome, "idempotent");
      assert.equal(duplicateClaim.event.modelClaimedAt?.getTime(), claimTime?.getTime());

      const completed = await repository.completeProcessing(owner, eventId);
      assert.equal(completed.outcome, "applied");
      assert.equal(completed.event.processingState, "completed");
      assert.equal(completed.event.modelCompletedAt instanceof Date, true);
      const completionTime = completed.event.modelCompletedAt;
      const duplicateComplete = await repository.completeProcessing(owner, eventId);
      assert.equal(duplicateComplete.outcome, "idempotent");
      assert.equal(duplicateComplete.event.modelCompletedAt?.getTime(), completionTime?.getTime());

      const hostSentId = randomUUID();
      await repository.createEvent(owner, createInput(hostSentId, "processing-host-sent"));
      assert.equal((await repository.reserveNext(owner, listener))?.id, hostSentId);
      assert.equal((await repository.markHostSent(owner, listener, hostSentId))?.status, "host_sent");
      const hostSentClaim = await repository.claimProcessing(owner, hostSentId);
      assert.equal(hostSentClaim.outcome, "applied");
      assert.equal(hostSentClaim.event.status, "host_sent");
      assert.equal(hostSentClaim.event.deliveryReconciledAt, null);

      const unknownId = randomUUID();
      await repository.createEvent(owner, createInput(unknownId, "processing-unknown"));
      assert.equal((await repository.reserveNext(owner, listener))?.id, unknownId);
      assert.equal((await repository.markDeliveryUnknown(owner, listener, unknownId, "HOST_TIMEOUT"))?.status, "delivery_unknown");
      const unknownClaim = await repository.claimProcessing(owner, unknownId);
      assert.equal(unknownClaim.outcome, "applied");
      assert.equal(unknownClaim.event.status, "delivery_unknown");
      assert.equal(unknownClaim.event.deliveryReconciledAt instanceof Date, true);

      const completeBeforeClaimId = randomUUID();
      await repository.createEvent(owner, createInput(completeBeforeClaimId, "processing-complete-before-claim"));
      assert.equal((await repository.reserveNext(owner, listener))?.id, completeBeforeClaimId);
      const completeBeforeClaim = await repository.completeProcessing(owner, completeBeforeClaimId);
      assert.deepEqual(completeBeforeClaim, { outcome: "conflict" });

      const callbackId = randomUUID();
      await repository.createEvent(owner, createInput(callbackId, "processing-callback"));
      assert.equal((await repository.reserveNext(owner, listener))?.id, callbackId);
      await repository.markDispatchStarted(owner, listener, callbackId);
      assert.equal((await repository.claimProcessing(owner, callbackId)).outcome, "applied");
      const callbackSent = await repository.markHostSent(owner, listener, callbackId);
      assert.equal(callbackSent?.status, "host_sent");
      assert.equal(callbackSent?.processingState, "claimed");
      assert.equal(callbackSent?.deliveryReconciledAt, null);

      const ambiguityId = randomUUID();
      await repository.createEvent(owner, createInput(ambiguityId, "processing-ambiguity"));
      assert.equal((await repository.reserveNext(owner, listener))?.id, ambiguityId);
      await repository.markDispatchStarted(owner, listener, ambiguityId);
      assert.equal((await repository.claimProcessing(owner, ambiguityId)).outcome, "applied");
      const ambiguityUnknown = await repository.markDeliveryUnknown(owner, listener, ambiguityId, "HOST_TIMEOUT");
      assert.equal(ambiguityUnknown?.status, "delivery_unknown");
      assert.equal(ambiguityUnknown?.processingState, "claimed");
      assert.equal(ambiguityUnknown?.deliveryReconciledAt instanceof Date, true);

      const staleClaimedId = randomUUID();
      await repository.createEvent(owner, createInput(staleClaimedId, "processing-stale-claimed"));
      await setReservation(admin.db, staleClaimedId, listener, new Date(Date.now() - 1_000), new Date(Date.now() - 2_000));
      assert.equal((await repository.claimProcessing(owner, staleClaimedId)).outcome, "applied");
      assert.equal(await repository.reserveNext(owner, listener), null);
      const staleClaimed = await repository.getEvent(owner, staleClaimedId);
      assert.equal(staleClaimed?.status, "delivery_unknown");
      assert.equal(staleClaimed?.deliveryReconciledAt instanceof Date, true);

      const staleUnclaimedId = randomUUID();
      await repository.createEvent(owner, createInput(staleUnclaimedId, "processing-stale-unclaimed"));
      await setReservation(admin.db, staleUnclaimedId, listener, new Date(Date.now() - 1_000), new Date(Date.now() - 2_000));
      assert.equal(await repository.reserveNext(owner, listener), null);
      const staleUnclaimed = await repository.getEvent(owner, staleUnclaimedId);
      assert.equal(staleUnclaimed?.status, "delivery_unknown");
      assert.equal(staleUnclaimed?.processingState, "unclaimed");
      assert.equal(staleUnclaimed?.deliveryReconciledAt, null);

      const crossOwnerClaim = await repository.claimProcessing(other, eventId);
      assert.deepEqual(crossOwnerClaim, { outcome: "not_found" });
      const crossOwnerComplete = await repository.completeProcessing(other, eventId);
      assert.deepEqual(crossOwnerComplete, { outcome: "not_found" });

      const unknown = await repository.claimProcessing(owner, randomUUID());
      assert.deepEqual(unknown, { outcome: "not_found" });
    } finally {
      await admin.db.delete(schema.bridgeListenerLeases).where(eq(schema.bridgeListenerLeases.userId, owner));
      await admin.db.delete(schema.bridgeEvents).where(eq(schema.bridgeEvents.userId, owner));
      await admin.db.delete(schema.users).where(eq(schema.users.id, owner));
      await admin.db.delete(schema.users).where(eq(schema.users.id, other));
      await admin.client.end();
    }
  },
);
