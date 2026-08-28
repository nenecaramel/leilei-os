import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  bridgeEvents,
  bridgeListenerLeases,
} from "../../database/schema.js";
import {
  BRIDGE_LISTENER_LEASE_MS,
  BRIDGE_RESERVATION_LEASE_MS,
} from "./bridge-constants.js";
import type {
  BridgeEventCreateInput,
  BridgeEventCreateResult,
  BridgeEventRecord,
  BridgeEventStatus,
  BridgeListenerLeaseResult,
} from "./bridge-event-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

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
  retryCount: bridgeEvents.retryCount,
  lastErrorCode: bridgeEvents.lastErrorCode,
};

type BridgeEventRow = BridgeEventRecord;

function asBridgeEvent(row: BridgeEventRow): BridgeEventRecord {
  return {
    ...row,
    kind: row.kind,
    source: row.source,
    status: row.status,
  };
}

async function lockUser(transaction: Transaction, userId: string): Promise<void> {
  await transaction.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))
  `);
}

export interface BridgeEventRepository {
  createEvent(
    userId: string,
    input: BridgeEventCreateInput,
  ): Promise<BridgeEventCreateResult>;
  getEvent(userId: string, eventId: string): Promise<BridgeEventRecord | null>;
  acquireListenerLease(
    userId: string,
    listenerInstanceId: string,
  ): Promise<BridgeListenerLeaseResult>;
  releaseListenerLease(userId: string, listenerInstanceId: string): Promise<boolean>;
  reserveNext(
    userId: string,
    listenerInstanceId: string,
  ): Promise<BridgeEventRecord | null>;
  markDispatchStarted(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
  ): Promise<BridgeEventRecord | null>;
  markHostSent(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
  ): Promise<BridgeEventRecord | null>;
  markDeliveryUnknown(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
    safeErrorCode: string,
  ): Promise<BridgeEventRecord | null>;
  release(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
    safeErrorCode?: string,
  ): Promise<BridgeEventRecord | null>;
  deleteTerminalBatch(cutoff: Date, limit: number): Promise<number>;
}

export class DrizzleBridgeEventRepository implements BridgeEventRepository {
  constructor(private readonly db: Database) {}

  async createEvent(
    userId: string,
    input: BridgeEventCreateInput,
  ): Promise<BridgeEventCreateResult> {
    return this.db.transaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(bridgeEvents)
        .values({ userId, ...input, status: "pending" })
        .onConflictDoNothing({
          target: [bridgeEvents.userId, bridgeEvents.idempotencyKey],
        })
        .returning(bridgeEventSelection);

      if (inserted) return { outcome: "created", event: asBridgeEvent(inserted) };

      const [existing] = await transaction
        .select(bridgeEventSelection)
        .from(bridgeEvents)
        .where(
          and(
            eq(bridgeEvents.userId, userId),
            eq(bridgeEvents.idempotencyKey, input.idempotencyKey),
          ),
        )
        .for("update")
        .limit(1);

      if (!existing || existing.requestHash !== input.requestHash) {
        return { outcome: "conflict" };
      }
      return { outcome: "replayed", event: asBridgeEvent(existing) };
    });
  }

  async getEvent(userId: string, eventId: string): Promise<BridgeEventRecord | null> {
    const [event] = await this.db
      .select(bridgeEventSelection)
      .from(bridgeEvents)
      .where(and(eq(bridgeEvents.userId, userId), eq(bridgeEvents.id, eventId)))
      .limit(1);
    return event ? asBridgeEvent(event) : null;
  }

  async acquireListenerLease(
    userId: string,
    listenerInstanceId: string,
  ): Promise<BridgeListenerLeaseResult> {
    return this.db.transaction(async (transaction) => {
      await lockUser(transaction, userId);
      const [existing] = await transaction
        .select({
          listenerInstanceId: bridgeListenerLeases.listenerInstanceId,
          active: sql<boolean>`${bridgeListenerLeases.leaseExpiresAt} > now()`,
        })
        .from(bridgeListenerLeases)
        .where(eq(bridgeListenerLeases.userId, userId))
        .for("update")
        .limit(1);

      if (existing?.active && existing.listenerInstanceId !== listenerInstanceId) {
        return { state: "busy" };
      }

      const state = existing?.listenerInstanceId === listenerInstanceId
        ? "renewed"
        : "acquired";
      await transaction
        .insert(bridgeListenerLeases)
        .values({
          userId,
          listenerInstanceId,
          leaseExpiresAt: sql`now() + ${BRIDGE_LISTENER_LEASE_MS} * interval '1 millisecond'`,
          updatedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: bridgeListenerLeases.userId,
          set: {
            listenerInstanceId,
            leaseExpiresAt: sql`now() + ${BRIDGE_LISTENER_LEASE_MS} * interval '1 millisecond'`,
            updatedAt: sql`now()`,
          },
        });
      return { state };
    });
  }

  async releaseListenerLease(userId: string, listenerInstanceId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(bridgeListenerLeases)
      .where(
        and(
          eq(bridgeListenerLeases.userId, userId),
          eq(bridgeListenerLeases.listenerInstanceId, listenerInstanceId),
        ),
      )
      .returning({ userId: bridgeListenerLeases.userId });
    return deleted.length === 1;
  }

  async reserveNext(
    userId: string,
    listenerInstanceId: string,
  ): Promise<BridgeEventRecord | null> {
    return this.db.transaction(async (transaction) => {
      const lease = await transaction.execute<{ user_id: string }>(sql`
        UPDATE bridge_listener_leases
        SET lease_expires_at = now() + ${BRIDGE_LISTENER_LEASE_MS} * interval '1 millisecond',
            updated_at = now()
        WHERE user_id = ${userId}::uuid
          AND listener_instance_id = ${listenerInstanceId}::uuid
          AND lease_expires_at > now()
        RETURNING user_id
      `);
      if (lease.length !== 1) return null;

      await transaction.execute(sql`
        UPDATE bridge_events
        SET status = 'delivery_unknown',
            delivery_unknown_at = now(),
            last_error_code = 'RESERVATION_EXPIRED_AFTER_DISPATCH'
        WHERE user_id = ${userId}::uuid
          AND status = 'reserved'
          AND reservation_expires_at <= now()
          AND dispatch_started_at IS NOT NULL
      `);
      await transaction.execute(sql`
        UPDATE bridge_events
        SET status = 'pending',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            dispatch_started_at = NULL
        WHERE user_id = ${userId}::uuid
          AND status = 'reserved'
          AND reservation_expires_at <= now()
          AND dispatch_started_at IS NULL
      `);

      const reserved = await transaction.execute<BridgeEventRow>(sql`
        WITH candidate AS (
          SELECT id
          FROM bridge_events
          WHERE user_id = ${userId}::uuid
            AND status = 'pending'
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE bridge_events AS event
        SET status = 'reserved',
            reserved_by = ${listenerInstanceId}::uuid,
            reserved_at = now(),
            reservation_expires_at = now() + ${BRIDGE_RESERVATION_LEASE_MS} * interval '1 millisecond',
            dispatch_started_at = NULL,
            last_error_code = NULL
        FROM candidate
        WHERE event.id = candidate.id
          AND event.user_id = ${userId}::uuid
          AND event.status = 'pending'
        RETURNING event.*
      `);
      return reserved[0] ? asBridgeEvent(reserved[0]) : null;
    });
  }

  async markDispatchStarted(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
  ): Promise<BridgeEventRecord | null> {
    const updated = await this.db
      .update(bridgeEvents)
      .set({ dispatchStartedAt: sql`COALESCE(${bridgeEvents.dispatchStartedAt}, now())` })
      .where(
        and(
          eq(bridgeEvents.userId, userId),
          eq(bridgeEvents.id, eventId),
          eq(bridgeEvents.reservedBy, listenerInstanceId),
          eq(bridgeEvents.status, "reserved"),
        ),
      )
      .returning(bridgeEventSelection);
    return updated[0] ? asBridgeEvent(updated[0]) : null;
  }

  async markHostSent(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
  ): Promise<BridgeEventRecord | null> {
    const updated = await this.db
      .update(bridgeEvents)
      .set({
        status: "host_sent",
        hostSentAt: sql`COALESCE(${bridgeEvents.hostSentAt}, now())`,
        lastErrorCode: null,
      })
      .where(
        and(
          eq(bridgeEvents.userId, userId),
          eq(bridgeEvents.id, eventId),
          eq(bridgeEvents.reservedBy, listenerInstanceId),
          eq(bridgeEvents.status, "reserved"),
        ),
      )
      .returning(bridgeEventSelection);
    if (updated[0]) return asBridgeEvent(updated[0]);
    return this.findTerminalForOwner(userId, listenerInstanceId, eventId, "host_sent");
  }

  async markDeliveryUnknown(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
    safeErrorCode: string,
  ): Promise<BridgeEventRecord | null> {
    const updated = await this.db
      .update(bridgeEvents)
      .set({
        status: "delivery_unknown",
        deliveryUnknownAt: sql`COALESCE(${bridgeEvents.deliveryUnknownAt}, now())`,
        lastErrorCode: safeErrorCode,
      })
      .where(
        and(
          eq(bridgeEvents.userId, userId),
          eq(bridgeEvents.id, eventId),
          eq(bridgeEvents.reservedBy, listenerInstanceId),
          eq(bridgeEvents.status, "reserved"),
        ),
      )
      .returning(bridgeEventSelection);
    if (updated[0]) return asBridgeEvent(updated[0]);
    return this.findTerminalForOwner(userId, listenerInstanceId, eventId, "delivery_unknown");
  }

  async release(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
    safeErrorCode: string | undefined,
  ): Promise<BridgeEventRecord | null> {
    const updated = await this.db
      .update(bridgeEvents)
      .set({
        status: "pending",
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        dispatchStartedAt: null,
        retryCount: sql`${bridgeEvents.retryCount} + 1`,
        lastErrorCode: safeErrorCode ?? null,
      })
      .where(
        and(
          eq(bridgeEvents.userId, userId),
          eq(bridgeEvents.id, eventId),
          eq(bridgeEvents.reservedBy, listenerInstanceId),
          eq(bridgeEvents.status, "reserved"),
        ),
      )
      .returning(bridgeEventSelection);
    return updated[0] ? asBridgeEvent(updated[0]) : null;
  }

  async deleteTerminalBatch(cutoff: Date, limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError("limit must be a positive integer");
    }
    return this.db.transaction(async (transaction) => {
      const victims = await transaction.execute<{ id: string }>(sql`
        SELECT id
        FROM bridge_events
        WHERE (status = 'host_sent' AND host_sent_at < ${cutoff.toISOString()}::timestamptz)
           OR (status = 'delivery_unknown' AND delivery_unknown_at < ${cutoff.toISOString()}::timestamptz)
        ORDER BY id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      if (victims.length === 0) return 0;
      const deleted = await transaction.execute<{ id: string }>(sql`
        DELETE FROM bridge_events
        WHERE id = ANY(${victims.map((victim) => victim.id)}::uuid[])
        RETURNING id
      `);
      return deleted.length;
    });
  }

  private async findTerminalForOwner(
    userId: string,
    listenerInstanceId: string,
    eventId: string,
    status: Extract<BridgeEventStatus, "host_sent" | "delivery_unknown">,
  ): Promise<BridgeEventRecord | null> {
    const [event] = await this.db
      .select(bridgeEventSelection)
      .from(bridgeEvents)
      .where(
        and(
          eq(bridgeEvents.userId, userId),
          eq(bridgeEvents.id, eventId),
          eq(bridgeEvents.reservedBy, listenerInstanceId),
          eq(bridgeEvents.status, status),
        ),
      )
      .limit(1);
    return event ? asBridgeEvent(event) : null;
  }
}

export type {
  BridgeEventCreateInput,
  BridgeEventCreateResult,
  BridgeEventRecord,
  BridgeListenerLeaseResult,
};
