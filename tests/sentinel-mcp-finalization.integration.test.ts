import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
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
