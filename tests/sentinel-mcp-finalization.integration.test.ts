import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/database/schema.js";
import { DrizzleBridgeEventRepository } from "../src/domains/bridge/bridge-event-repository.js";
import { DrizzleSentinelRepository } from "../src/domains/sentinel/sentinel-repository.js";
import { SentinelDomainError, SentinelService } from "../src/domains/sentinel/sentinel-service.js";

const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const RUN = process.env.RUN_SENTINEL_DATABASE_TEST === "1" &&
  (target?.hostname === "127.0.0.1" || target?.hostname === "localhost");

function connection() {
  const client = postgres(databaseUrl!, { max: 4, prepare: false, ssl: false });
  return { client, db: drizzle(client, { schema }) };
}

class RollbackSentinelTest extends Error {}

test(
  "Sentinel MCP finalization is atomic, DB-time bounded, and hash-idempotent",
  { skip: RUN ? false : "SKIP: set RUN_SENTINEL_DATABASE_TEST=1 with a local DATABASE_URL" },
  async () => {
    const admin = connection();
    const owner = randomUUID();
    const listener = randomUUID();
    const wakeId = randomUUID();
    const now = new Date();
    try {
      await admin.db.insert(schema.users).values({
        id: owner,
        email: `sentinel-finalize-${owner}@example.invalid`,
        displayName: "Sentinel finalize",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const repository = new DrizzleSentinelRepository(admin.db as never);
      const bridge = new DrizzleBridgeEventRepository(admin.db as never);
      const service = new SentinelService(repository, { createId: () => wakeId });
      const sentinel = await repository.createSentinel({ userId: owner, timezone: "UTC", policyPrompt: "check in" });
      await admin.db.update(schema.sentinels).set({ enabled: true, nextWakeAt: new Date(now.getTime() - 1_000) }).where(eq(schema.sentinels.id, sentinel.id));
      const enqueued = await service.enqueueWake(owner, { cause: "scheduled", scheduledFor: new Date(now.getTime() - 1_000), wakeId });
      assert.equal(enqueued.outcome, "created");
      assert.equal((await bridge.acquireListenerLease(owner, listener)).state, "acquired");
      assert.equal((await bridge.reserveNext(owner, listener))?.id, enqueued.bridge.id);
      await bridge.markDispatchStarted(owner, listener, enqueued.bridge.id);
      assert.equal((await bridge.claimProcessing(owner, enqueued.bridge.id)).outcome, "applied");

      const nextWakeAt = new Date(Date.now() + 10 * 60 * 1_000);
      const first = await service.completeWake(owner, {
        wakeId,
        decision: "quiet",
        nextWakeAt,
        contextCapsule: " calm ",
      });
      assert.equal(first.outcome, "applied");
      assert.equal(first.wake.state, "finalized");
      assert.equal(first.wake.finalizedAt instanceof Date, true);
      assert.equal(first.wake.completionPayloadHash?.length, 64);
      assert.equal(first.bridge.processingState, "completed");
      assert.equal(first.sentinel.activeWakeRunId, null);
      assert.equal(first.sentinel.controlRevision, sentinel.controlRevision + 1);
      assert.equal(first.sentinel.wakeContextCapsule, "calm");
      assert.equal(first.sentinel.nextWakeAt?.getTime(), nextWakeAt.getTime());

      // Overwrite the current capsule to prove replay uses the Wake Run hash,
      // not whichever capsule belongs to a later wake.
      await admin.db.update(schema.sentinels).set({ wakeContextCapsule: "newer capsule" }).where(eq(schema.sentinels.id, sentinel.id));
      const replay = await service.completeWake(owner, {
        wakeId,
        decision: "quiet",
        nextWakeAt,
        contextCapsule: "calm",
      });
      assert.equal(replay.outcome, "idempotent");
      assert.equal(replay.wake.completionPayloadHash, first.wake.completionPayloadHash);

      await assert.rejects(
        service.completeWake(owner, {
          wakeId,
          decision: "contact",
          nextWakeAt,
          contextCapsule: "calm",
        }),
        (error: unknown) => error instanceof SentinelDomainError && error.code === "SENTINEL_WAKE_CONFLICT",
      );

      const [storedWake] = await admin.db.select().from(schema.sentinelWakeRuns).where(and(eq(schema.sentinelWakeRuns.id, wakeId), eq(schema.sentinelWakeRuns.userId, owner)));
      const [storedBridge] = await admin.db.select().from(schema.bridgeEvents).where(eq(schema.bridgeEvents.id, enqueued.bridge.id));
      assert.equal(storedWake?.state, "finalized");
      assert.equal(storedBridge?.processingState, "completed");
      assert.equal(storedWake?.finalizedAt instanceof Date, true);
      assert.equal(storedBridge?.modelCompletedAt instanceof Date, true);
    } finally {
      await admin.db.delete(schema.bridgeListenerLeases).where(eq(schema.bridgeListenerLeases.userId, owner));
      await admin.db.delete(schema.sentinelWakeRuns).where(eq(schema.sentinelWakeRuns.userId, owner));
      await admin.db.delete(schema.bridgeEvents).where(eq(schema.bridgeEvents.userId, owner));
      await admin.db.delete(schema.sentinels).where(eq(schema.sentinels.userId, owner));
      await admin.db.delete(schema.users).where(eq(schema.users.id, owner));
      await admin.client.end();
    }
  },
);

test(
  "real PostgreSQL rejects every unsafe Sentinel finalization without changing authoritative state",
  { skip: RUN ? false : "SKIP: set RUN_SENTINEL_DATABASE_TEST=1 with a local DATABASE_URL" },
  async () => {
    const client = postgres(databaseUrl!, { max: 8, prepare: false, ssl: false });
    const db = drizzle(client, { schema });
    const ownerId = randomUUID();
    const otherUserId = randomUUID();
    const timestamp = new Date("2026-08-29T00:00:00.000Z");
    try {
      await assert.rejects(
        db.transaction(async (transaction) => {
          await transaction.insert(schema.users).values([
            {
              id: ownerId,
              email: `sentinel-matrix-owner-${ownerId}@example.invalid`,
              displayName: "Sentinel matrix owner",
              status: "active",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            {
              id: otherUserId,
              email: `sentinel-matrix-other-${otherUserId}@example.invalid`,
              displayName: "Sentinel matrix other",
              status: "active",
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ]);

          const repository = new DrizzleSentinelRepository(transaction as never);
          const bridge = new DrizzleBridgeEventRepository(transaction as never);
          const service = new SentinelService(repository);
          const sentinel = await repository.createSentinel({
            userId: ownerId,
            timezone: "UTC",
            policyPrompt: "bounded matrix",
          });
          await transaction
            .update(schema.sentinels)
            .set({ enabled: true, nextWakeAt: new Date(timestamp.getTime() - 1_000) })
            .where(eq(schema.sentinels.id, sentinel.id));

          const wakeId = randomUUID();
          const enqueued = await service.enqueueWake(ownerId, {
            cause: "scheduled",
            scheduledFor: new Date(timestamp.getTime() - 1_000),
            wakeId,
          });
          assert.equal(enqueued.outcome, "created");
          if (enqueued.outcome !== "created") throw new Error("matrix fixture did not enqueue");

          const snapshot = async () => {
            const [sentinelRow] = await transaction
              .select()
              .from(schema.sentinels)
              .where(eq(schema.sentinels.id, sentinel.id));
            const [wakeRow] = await transaction
              .select()
              .from(schema.sentinelWakeRuns)
              .where(eq(schema.sentinelWakeRuns.id, wakeId));
            const [bridgeRow] = await transaction
              .select()
              .from(schema.bridgeEvents)
              .where(eq(schema.bridgeEvents.id, enqueued.bridge.id));
            return { sentinelRow, wakeRow, bridgeRow };
          };
          const validNextWakeAt = new Date(Date.now() + 10 * 60 * 1_000);
          const payload = (overrides: Partial<{
            decision: "contact" | "quiet";
            nextWakeAt: Date;
            contextCapsule: string;
          }> = {}) => ({
            wakeId,
            decision: overrides.decision ?? "quiet",
            nextWakeAt: overrides.nextWakeAt ?? validNextWakeAt,
            contextCapsule: overrides.contextCapsule ?? "calm",
          });
          const expectConflictWithoutMutation = async (
            operation: () => Promise<unknown>,
            code: string,
          ) => {
            const before = await snapshot();
            await assert.rejects(operation, (error: unknown) =>
              error instanceof SentinelDomainError && error.code === code,
            );
            assert.deepEqual(await snapshot(), before);
          };

          await expectConflictWithoutMutation(
            () => service.completeWake(ownerId, payload()),
            "SENTINEL_WAKE_CONFLICT",
          );

          const listenerId = randomUUID();
          assert.equal((await bridge.acquireListenerLease(ownerId, listenerId)).state, "acquired");
          assert.equal((await bridge.reserveNext(ownerId, listenerId))?.id, enqueued.bridge.id);
          await bridge.markDispatchStarted(ownerId, listenerId, enqueued.bridge.id);
          assert.equal((await bridge.claimProcessing(ownerId, enqueued.bridge.id)).outcome, "applied");

          await expectConflictWithoutMutation(
            () => service.completeWake(otherUserId, payload()),
            "SENTINEL_WAKE_NOT_FOUND",
          );

          await transaction
            .update(schema.sentinels)
            .set({ enabled: false })
            .where(eq(schema.sentinels.id, sentinel.id));
          await expectConflictWithoutMutation(
            () => service.completeWake(ownerId, payload()),
            "SENTINEL_WAKE_CONFLICT",
          );
          await transaction
            .update(schema.sentinels)
            .set({ enabled: true })
            .where(eq(schema.sentinels.id, sentinel.id));

          await transaction
            .update(schema.sentinels)
            .set({ controlRevision: sql`${schema.sentinels.controlRevision} + 1` })
            .where(eq(schema.sentinels.id, sentinel.id));
          await expectConflictWithoutMutation(
            () => service.completeWake(ownerId, payload()),
            "SENTINEL_WAKE_CONFLICT",
          );
          await transaction
            .update(schema.sentinels)
            .set({ controlRevision: sentinel.controlRevision })
            .where(eq(schema.sentinels.id, sentinel.id));

          await transaction
            .update(schema.sentinels)
            .set({ activeWakeRunId: null, nextWakeAt: new Date(Date.now() + 10 * 60 * 1_000) })
            .where(eq(schema.sentinels.id, sentinel.id));
          await expectConflictWithoutMutation(
            () => service.completeWake(ownerId, payload()),
            "SENTINEL_WAKE_CONFLICT",
          );
          await transaction
            .update(schema.sentinels)
            .set({ activeWakeRunId: wakeId, nextWakeAt: null })
            .where(eq(schema.sentinels.id, sentinel.id));

          await expectConflictWithoutMutation(
            () => service.completeWake(ownerId, payload({ nextWakeAt: new Date(Date.now() + 60 * 1_000) })),
            "NEXT_WAKE_TOO_SOON",
          );
          await expectConflictWithoutMutation(
            () => service.completeWake(ownerId, payload({ nextWakeAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000) })),
            "NEXT_WAKE_TOO_FAR",
          );
          await expectConflictWithoutMutation(
            () => service.completeWake(ownerId, payload({ contextCapsule: "🙂".repeat(1_025) })),
            "CAPSULE_TOO_LONG",
          );

          const first = await service.completeWake(ownerId, payload({ contextCapsule: "calm" }));
          assert.equal(first.outcome, "applied");
          if (first.outcome !== "applied") throw new Error("matrix fixture did not finalize");
          assert.equal(first.wake.state, "finalized");
          const finalized = await snapshot();
          const replay = await service.completeWake(ownerId, payload({ contextCapsule: "calm" }));
          assert.equal(replay.outcome, "idempotent");
          assert.deepEqual(await snapshot(), finalized);

          await transaction
            .update(schema.sentinels)
            .set({ wakeContextCapsule: "newer capsule" })
            .where(eq(schema.sentinels.id, sentinel.id));
          const afterCapsuleReplacement = await snapshot();
          await assert.rejects(
            service.completeWake(ownerId, payload({ decision: "contact" })),
            (error: unknown) =>
              error instanceof SentinelDomainError && error.code === "SENTINEL_WAKE_CONFLICT",
          );
          assert.deepEqual(await snapshot(), afterCapsuleReplacement);

          throw new RollbackSentinelTest();
        }),
        (error: unknown) => error instanceof RollbackSentinelTest,
      );
    } finally {
      await client.end();
    }
  },
);
