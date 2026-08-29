import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { createDatabase } from "../../database/client.js";
import {
  bridgeEvents,
  sentinelWakeRuns,
  sentinels,
} from "../../database/schema.js";
import {
  createSentinelWakeModelContext,
  hashSentinelWakeRequest,
} from "../bridge/bridge-service.js";
import type {
  SentinelMutationResult,
  SentinelRecord,
  SentinelWakeCause,
  SentinelWakeCancellationResult,
  SentinelWakeEnqueueInput,
  SentinelWakeEnqueueResult,
  SentinelWakeRunRecord,
} from "./sentinel-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function readSentinelDatabaseNow(transaction: Transaction): Promise<Date> {
  const rows = await transaction.execute<{ now: Date }>(sql`SELECT CURRENT_TIMESTAMP AS now`);
  const value = rows[0]?.now;
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Database clock returned an invalid timestamp.");
  }
  return date;
}

const sentinelSelection = {
  id: sentinels.id,
  userId: sentinels.userId,
  enabled: sentinels.enabled,
  timezone: sentinels.timezone,
  policyPrompt: sentinels.policyPrompt,
  nextWakeAt: sentinels.nextWakeAt,
  lastValidWakeAt: sentinels.lastValidWakeAt,
  wakeContextCapsule: sentinels.wakeContextCapsule,
  wakeContextUpdatedAt: sentinels.wakeContextUpdatedAt,
  controlRevision: sentinels.controlRevision,
  activeWakeRunId: sentinels.activeWakeRunId,
  createdAt: sentinels.createdAt,
  updatedAt: sentinels.updatedAt,
};

const wakeRunSelection = {
  id: sentinelWakeRuns.id,
  sentinelId: sentinelWakeRuns.sentinelId,
  userId: sentinelWakeRuns.userId,
  controlRevision: sentinelWakeRuns.controlRevision,
  cause: sentinelWakeRuns.cause,
  scheduledFor: sentinelWakeRuns.scheduledFor,
  triggeredAt: sentinelWakeRuns.triggeredAt,
  bridgeEventId: sentinelWakeRuns.bridgeEventId,
  state: sentinelWakeRuns.state,
  decision: sentinelWakeRuns.decision,
  nextWakeAt: sentinelWakeRuns.nextWakeAt,
  completionPayloadHash: sentinelWakeRuns.completionPayloadHash,
  claimedAt: sentinelWakeRuns.claimedAt,
  finalizedAt: sentinelWakeRuns.finalizedAt,
  failureCode: sentinelWakeRuns.failureCode,
  createdAt: sentinelWakeRuns.createdAt,
  updatedAt: sentinelWakeRuns.updatedAt,
};

const bridgeEventSelection = {
  id: bridgeEvents.id,
  userId: bridgeEvents.userId,
  idempotencyKey: bridgeEvents.idempotencyKey,
  requestHash: bridgeEvents.requestHash,
  kind: bridgeEvents.kind,
  source: bridgeEvents.source,
  visibleText: bridgeEvents.visibleText,
  modelContext: bridgeEvents.modelContext,
  status: bridgeEvents.status,
  createdAt: bridgeEvents.createdAt,
  reservedBy: bridgeEvents.reservedBy,
  reservedAt: bridgeEvents.reservedAt,
  reservationExpiresAt: bridgeEvents.reservationExpiresAt,
  dispatchStartedAt: bridgeEvents.dispatchStartedAt,
  hostSentAt: bridgeEvents.hostSentAt,
  deliveryUnknownAt: bridgeEvents.deliveryUnknownAt,
  cancelledAt: bridgeEvents.cancelledAt,
  processingState: bridgeEvents.processingState,
  modelClaimedAt: bridgeEvents.modelClaimedAt,
  modelCompletedAt: bridgeEvents.modelCompletedAt,
  deliveryReconciledAt: bridgeEvents.deliveryReconciledAt,
  retryCount: bridgeEvents.retryCount,
  lastErrorCode: bridgeEvents.lastErrorCode,
};

export type SentinelCreateInput = {
  userId: string;
  timezone: string;
  policyPrompt: string;
};

export type SentinelPolicyUpdateInput = {
  userId: string;
  timezone: string;
  policyPrompt: string;
};

export type SentinelWakeRunCreateInput = {
  sentinelId: string;
  userId: string;
  controlRevision: number;
  cause: SentinelWakeCause;
  scheduledFor: Date;
  bridgeEventId: string;
};

export interface SentinelRepository {
  findByUserId(userId: string): Promise<SentinelRecord | null>;
  createSentinel(input: SentinelCreateInput): Promise<SentinelRecord>;
  createForUser?(input: SentinelCreateInput): Promise<SentinelRecord>;
  updatePolicy(
    input: SentinelPolicyUpdateInput,
  ): Promise<SentinelMutationResult>;
  updateForUser?(input: SentinelPolicyUpdateInput): Promise<SentinelMutationResult>;
  compareAndAdvanceRevision(input: {
    userId: string;
    expectedRevision: number;
  }): Promise<SentinelMutationResult>;
  createWakeRun(input: SentinelWakeRunCreateInput): Promise<SentinelWakeRunRecord>;
  createWakeWithBridge?(input: SentinelWakeEnqueueInput): Promise<SentinelWakeEnqueueResult>;
  cancelWakeBeforeDispatch?(
    userId: string,
    wakeId: string,
  ): Promise<SentinelWakeCancellationResult>;
  createDueWake?(now: Date | undefined, wakeId: string): Promise<SentinelWakeEnqueueResult>;
  markStaleWakeRuns?(now: Date | undefined, timeoutMs: number): Promise<number>;
}

export class DrizzleSentinelRepository implements SentinelRepository {
  constructor(private readonly db: Database) {}

  async findByUserId(userId: string): Promise<SentinelRecord | null> {
    const [row] = await this.db
      .select(sentinelSelection)
      .from(sentinels)
      .where(eq(sentinels.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async createSentinel(input: SentinelCreateInput): Promise<SentinelRecord> {
    const [row] = await this.db
      .insert(sentinels)
      .values({
        userId: input.userId,
        timezone: input.timezone,
        policyPrompt: input.policyPrompt,
        enabled: false,
        nextWakeAt: null,
        lastValidWakeAt: null,
        wakeContextCapsule: null,
        wakeContextUpdatedAt: null,
        controlRevision: 0,
        activeWakeRunId: null,
      })
      .returning(sentinelSelection);
    if (!row) throw new Error("Sentinel insert did not return a row.");
    return row;
  }

  async createForUser(input: SentinelCreateInput): Promise<SentinelRecord> {
    return this.createSentinel(input);
  }

  async updatePolicy(
    input: SentinelPolicyUpdateInput,
  ): Promise<SentinelMutationResult> {
    const [row] = await this.db
      .update(sentinels)
      .set({
        timezone: input.timezone,
        policyPrompt: input.policyPrompt,
        updatedAt: new Date(),
      })
      .where(eq(sentinels.userId, input.userId))
      .returning(sentinelSelection);
    return row ? { outcome: "applied", sentinel: row } : { outcome: "not_found" };
  }

  async updateForUser(
    input: SentinelPolicyUpdateInput,
  ): Promise<SentinelMutationResult> {
    return this.updatePolicy(input);
  }

  async compareAndAdvanceRevision(input: {
    userId: string;
    expectedRevision: number;
  }): Promise<SentinelMutationResult> {
    const current = await this.findByUserId(input.userId);
    if (!current) return { outcome: "not_found" };

    const [row] = await this.db
      .update(sentinels)
      .set({
        controlRevision: sql`${sentinels.controlRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sentinels.userId, input.userId),
          eq(sentinels.controlRevision, input.expectedRevision),
        ),
      )
      .returning(sentinelSelection);
    return row ? { outcome: "applied", sentinel: row } : { outcome: "conflict" };
  }

  async createWakeRun(
    input: SentinelWakeRunCreateInput,
  ): Promise<SentinelWakeRunRecord> {
    const [row] = await this.db
      .insert(sentinelWakeRuns)
      .values({
        sentinelId: input.sentinelId,
        userId: input.userId,
        controlRevision: input.controlRevision,
        cause: input.cause,
        scheduledFor: input.scheduledFor,
        bridgeEventId: input.bridgeEventId,
        state: "bridge_enqueued",
      })
      .returning(wakeRunSelection);
    if (!row) throw new Error("Wake Run insert did not return a row.");
    return row;
  }

  async createWakeWithBridge(
    input: SentinelWakeEnqueueInput,
  ): Promise<SentinelWakeEnqueueResult> {
    return this.db.transaction((transaction) =>
      this.createWakeWithBridgeInTransaction(transaction, input),
    );
  }

  private async createWakeWithBridgeInTransaction(
    transaction: Transaction,
    input: SentinelWakeEnqueueInput,
    lockedSentinel?: SentinelRecord,
  ): Promise<SentinelWakeEnqueueResult> {
    const sentinel = lockedSentinel ?? (await transaction
      .select(sentinelSelection)
      .from(sentinels)
      .where(and(eq(sentinels.id, input.sentinelId), eq(sentinels.userId, input.userId)))
      .for("update")
      .limit(1))[0];
    if (!sentinel) return { outcome: "not_found" };

    const [existingWake] = await transaction
      .select(wakeRunSelection)
      .from(sentinelWakeRuns)
      .where(
        and(
          eq(sentinelWakeRuns.id, input.wakeId),
          eq(sentinelWakeRuns.userId, input.userId),
        ),
      )
      .limit(1);
    if (existingWake) {
      const [existingBridge] = await transaction
        .select(bridgeEventSelection)
        .from(bridgeEvents)
        .where(eq(bridgeEvents.id, existingWake.bridgeEventId))
        .limit(1);
      if (!existingBridge) return { outcome: "conflict" };
      return {
        outcome: "idempotent",
        wake: existingWake,
        bridge: existingBridge,
      };
    }
    if (sentinel.activeWakeRunId !== null) return { outcome: "conflict" };

    const bridgeEventId = randomUUID();
    const idempotencyKey = input.bridgeIdempotencyKey ?? `sentinel-wake-${input.wakeId}`;
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      return { outcome: "conflict" };
    }
    const [bridge] = await transaction
      .insert(bridgeEvents)
      .values({
        id: bridgeEventId,
        userId: input.userId,
        idempotencyKey,
        requestHash: hashSentinelWakeRequest(input.wakeId),
        kind: "wake",
        source: "leileios_sentinel",
        visibleText: "[LeileiOS Sentinel wake]",
        modelContext: createSentinelWakeModelContext({
          eventId: bridgeEventId,
          wakeId: input.wakeId,
          sentinelId: input.sentinelId,
          controlRevision: input.controlRevision,
          scheduledFor: input.scheduledFor,
        }),
        status: "pending",
        createdAt: input.scheduledFor,
      })
      .returning(bridgeEventSelection);
    if (!bridge) throw new Error("Sentinel Bridge event insert did not return a row.");

    const [wake] = await transaction
      .insert(sentinelWakeRuns)
      .values({
        id: input.wakeId,
        sentinelId: input.sentinelId,
        userId: input.userId,
        controlRevision: input.controlRevision,
        cause: input.cause,
        scheduledFor: input.scheduledFor,
        bridgeEventId,
        state: "bridge_enqueued",
      })
      .returning(wakeRunSelection);
    if (!wake) throw new Error("Sentinel Wake Run insert did not return a row.");

    await transaction
      .update(sentinels)
      .set({
        activeWakeRunId: wake.id,
        nextWakeAt: input.clearNextWakeAt === false ? sentinel.nextWakeAt : null,
        updatedAt: sql`now()`,
      })
      .where(eq(sentinels.id, input.sentinelId));

    return { outcome: "created", wake, bridge };
  }

  async createDueWake(
    now: Date | undefined,
    wakeId: string,
  ): Promise<SentinelWakeEnqueueResult> {
    return this.db.transaction(async (transaction) => {
      await readSentinelDatabaseNow(transaction);
      const dueNow = now
        ? sql`${now.toISOString()}::timestamptz`
        : sql`CURRENT_TIMESTAMP`;
      // Lock only one eligible row. The conditional predicate is repeated in
      // this transaction so concurrent schedulers cannot enqueue a successor.
      const dueIds = await transaction.execute<{ id: string }>(sql`
        SELECT ${sentinels.id} AS id
        FROM ${sentinels}
        WHERE ${sentinels.enabled} = true
          AND ${sentinels.nextWakeAt} IS NOT NULL
          AND ${sentinels.nextWakeAt} <= ${dueNow}
          AND ${sentinels.activeWakeRunId} IS NULL
        ORDER BY ${sentinels.nextWakeAt}, ${sentinels.id}
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `);
      const dueId = dueIds[0]?.id;
      if (!dueId) return { outcome: "not_found" };

      const [sentinel] = await transaction
        .select(sentinelSelection)
        .from(sentinels)
        .where(eq(sentinels.id, dueId))
        .limit(1);
      if (!sentinel || sentinel.nextWakeAt === null) {
        return { outcome: "not_found" };
      }

      return this.createWakeWithBridgeInTransaction(transaction, {
        userId: sentinel.userId,
        sentinelId: sentinel.id,
        controlRevision: sentinel.controlRevision,
        cause: "scheduled",
        scheduledFor: sentinel.nextWakeAt,
        wakeId,
        bridgeIdempotencyKey: `sentinel-wake-${wakeId}`,
        clearNextWakeAt: true,
      }, sentinel);
    });
  }

  async markStaleWakeRuns(now: Date | undefined, timeoutMs: number): Promise<number> {
    const cutoff = now ? new Date(now.getTime() - timeoutMs) : null;
    if (cutoff && !Number.isFinite(cutoff.getTime())) return 0;
    return this.db.transaction(async (transaction) => {
      await readSentinelDatabaseNow(transaction);
      const staleBefore = cutoff
        ? sql`${cutoff.toISOString()}::timestamptz`
        : sql`CURRENT_TIMESTAMP - ${timeoutMs} * interval '1 millisecond'`;
      const rows = await transaction
        .update(sentinelWakeRuns)
        .set({
          state: "recovery_required",
          failureCode: "WAKE_FINALIZATION_TIMEOUT",
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(sentinelWakeRuns.state, "claimed"),
            sql`${sentinelWakeRuns.claimedAt} IS NOT NULL`,
            sql`${sentinelWakeRuns.claimedAt} <= ${staleBefore}`,
          ),
        )
        .returning({ id: sentinelWakeRuns.id });
      return rows.length;
    });
  }

  async cancelWakeBeforeDispatch(
    userId: string,
    wakeId: string,
  ): Promise<SentinelWakeCancellationResult> {
    return this.db.transaction(async (transaction) => {
      const [wake] = await transaction
        .select(wakeRunSelection)
        .from(sentinelWakeRuns)
        .where(and(eq(sentinelWakeRuns.id, wakeId), eq(sentinelWakeRuns.userId, userId)))
        .for("update")
        .limit(1);
      if (!wake) return { outcome: "not_found" };
      const [bridge] = await transaction
        .select(bridgeEventSelection)
        .from(bridgeEvents)
        .where(and(eq(bridgeEvents.id, wake.bridgeEventId), eq(bridgeEvents.userId, userId)))
        .for("update")
        .limit(1);
      if (
        !bridge ||
        bridge.kind !== "wake" ||
        bridge.source !== "leileios_sentinel" ||
        bridge.dispatchStartedAt !== null ||
        (bridge.status !== "pending" && bridge.status !== "reserved")
      ) {
        return { outcome: "conflict" };
      }
      const [cancelledBridge] = await transaction
        .update(bridgeEvents)
        .set({
          cancelledAt: sql`COALESCE(${bridgeEvents.cancelledAt}, now())`,
          status: "pending",
          reservedBy: null,
          reservedAt: null,
          reservationExpiresAt: null,
          lastErrorCode: "SENTINEL_WAKE_CANCELLED",
        })
        .where(eq(bridgeEvents.id, bridge.id))
        .returning(bridgeEventSelection);
      const [supersededWake] = await transaction
        .update(sentinelWakeRuns)
        .set({ state: "superseded", updatedAt: sql`now()` })
        .where(eq(sentinelWakeRuns.id, wake.id))
        .returning(wakeRunSelection);
      await transaction
        .update(sentinels)
        .set({ activeWakeRunId: null, updatedAt: sql`now()` })
        .where(and(eq(sentinels.id, wake.sentinelId), eq(sentinels.activeWakeRunId, wake.id)));
      if (!cancelledBridge || !supersededWake) return { outcome: "conflict" };
      return { outcome: "cancelled", wake: supersededWake, bridge: cancelledBridge };
    });
  }
}
