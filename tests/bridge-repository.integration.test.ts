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
      assert.equal(concurrent.find(Boolean)?.id, onlyId);
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
