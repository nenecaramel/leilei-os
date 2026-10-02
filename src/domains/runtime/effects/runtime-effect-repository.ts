import { isDeepStrictEqual } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  runtimeEffects,
} from "../../../database/schema.js";
import type {
  DurableEffect,
  EffectStatus,
} from "./effect-protocol.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;
type Executor = Database | Transaction;

const DEFAULT_RESERVATION_LEASE_MS = 60_000;
const DEFAULT_DISPATCH_LEASE_MS = 120_000;
const MAX_LEASE_MS = 10 * 60_000;

export type RuntimeEffectPayload = Record<string, unknown>;

export type RuntimeEffectRecord = DurableEffect & {
  sourceWakeId: string;
  payload: RuntimeEffectPayload;
  reservedBy: string | null;
  reservedAt: string | null;
  reservationExpiresAt: string | null;
  dispatchStartedAt: string | null;
  observedAt: string | null;
  failureCode: string | null;
};

export type RuntimeEffectCreate = {
  effect: DurableEffect;
  sourceWakeId: string;
  payload: RuntimeEffectPayload;
};

export type RuntimeEffectDispatchOutcome =
  | {
      outcome: "observed";
      observedAt?: string;
    }
  | {
      outcome: "failed";
      failureCode: string;
      retryable: boolean;
    }
  | {
      outcome: "unknown";
      failureCode?: string;
    };

export class RuntimeEffectRepositoryError extends Error {
  constructor(
    readonly code:
      | "EFFECT_NOT_FOUND"
      | "EFFECT_CONFLICT"
      | "RESERVATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "RuntimeEffectRepositoryError";
  }
}

export interface RuntimeEffectPort {
  createOrGet(
    input: RuntimeEffectCreate,
  ): Promise<RuntimeEffectRecord>;

  get(input: {
    userId: string;
    effectId: string;
  }): Promise<RuntimeEffectRecord | null>;

  getBySourceWake(input: {
    userId: string;
    sourceWakeId: string;
  }): Promise<RuntimeEffectRecord | null>;

  findNextUnknown(input: {
    userId: string;
  }): Promise<RuntimeEffectRecord | null>;

  findNextRetryableFailed(input: {
    userId: string;
  }): Promise<RuntimeEffectRecord | null>;

  reserveNext(input: {
    userId: string;
    workerInstanceId: string;
    leaseMs?: number;
  }): Promise<RuntimeEffectRecord | null>;

  releaseReservation(input: {
    userId: string;
    effectId: string;
    workerInstanceId: string;
  }): Promise<RuntimeEffectRecord>;

  beginDispatch(input: {
    userId: string;
    effectId: string;
    workerInstanceId: string;
    leaseMs?: number;
  }): Promise<RuntimeEffectRecord>;

  completeDispatch(input: {
    userId: string;
    effectId: string;
    workerInstanceId: string;
    result: RuntimeEffectDispatchOutcome;
  }): Promise<RuntimeEffectRecord>;

  requeueFailed(input: {
    userId: string;
    effectId: string;
  }): Promise<RuntimeEffectRecord>;

  reconcileUnknown(input: {
    userId: string;
    effectId: string;
    resolution:
      | { outcome: "observed"; observedAt?: string }
      | {
          outcome: "failed";
          failureCode: string;
          retryable: boolean;
        };
  }): Promise<RuntimeEffectRecord>;
}

export class DrizzleRuntimeEffectRepository
implements RuntimeEffectPort {
  constructor(private readonly db: Database) {}

  async createOrGet(
    input: RuntimeEffectCreate,
  ): Promise<RuntimeEffectRecord> {
    if (
      input.effect.status !== "pending"
      || input.effect.attempt !== 0
      || !input.effect.retryable
      || input.effect.reservedBy
      || input.effect.reservedAt
      || input.effect.reservationExpiresAt
      || input.effect.dispatchStartedAt
      || input.effect.observedAt
      || input.effect.failureCode
    ) {
      throw new RuntimeEffectRepositoryError(
        "EFFECT_CONFLICT",
        "New runtime effects must enter through the pristine pending state.",
      );
    }

    return this.db.transaction(async (transaction) => {
      const targetConversationId =
        parseConversationTarget(input.effect.target);
      if (targetConversationId) {
        const active = await transaction.execute<{ id: string }>(sql`
          SELECT id
          FROM conversations
          WHERE id = ${targetConversationId}::uuid
            AND user_id = ${input.effect.userId}::uuid
            AND origin = 'native_live'
            AND lifecycle_status = 'active'
          FOR SHARE
        `);
        if (active.length !== 1) {
          throw new Error("RuntimeEffectTargetConversationInactive");
        }
      }

      await transaction
        .insert(runtimeEffects)
        .values({
          id: input.effect.effectId,
          userId: input.effect.userId,
          subjectId: input.effect.subjectId,
          sourceWakeId: input.sourceWakeId,
          decisionId: input.effect.decisionId,
          idempotencyKey: input.effect.idempotencyKey,
          effectType: input.effect.effectType,
          target: input.effect.target,
          payload: input.payload,
          payloadHash: input.effect.payloadHash,
          status: input.effect.status,
          attempt: input.effect.attempt,
          retryable: input.effect.retryable,
          observedAt: input.effect.observedAt
            ? new Date(input.effect.observedAt)
            : null,
          failureCode: input.effect.failureCode ?? null,
        })
        .onConflictDoNothing();

      const rows = await transaction
        .select({ id: runtimeEffects.id })
        .from(runtimeEffects)
        .where(
          and(
            eq(runtimeEffects.userId, input.effect.userId),
            eq(runtimeEffects.sourceWakeId, input.sourceWakeId),
          ),
        )
        .limit(1);
      const effectId = rows[0]?.id;
      const current = effectId
        ? await this.getWithExecutor(
            transaction as Transaction,
            input.effect.userId,
            effectId,
          )
        : null;
      if (!current) {
        throw new Error(
          "Runtime effect disappeared after create.",
        );
      }

      if (
        current.effectId !== input.effect.effectId
        || current.subjectId !== input.effect.subjectId
        || current.decisionId !== input.effect.decisionId
        || current.idempotencyKey !== input.effect.idempotencyKey
        || current.effectType !== input.effect.effectType
        || current.target !== input.effect.target
        || current.payloadHash !== input.effect.payloadHash
        || !isDeepStrictEqual(current.payload, input.payload)
      ) {
        throw new RuntimeEffectRepositoryError(
          "EFFECT_CONFLICT",
          "Runtime effect idempotency key conflicts with existing durable state.",
        );
      }
      return current;
    });
  }

  get(input: {
    userId: string;
    effectId: string;
  }): Promise<RuntimeEffectRecord | null> {
    return this.getWithExecutor(
      this.db,
      input.userId,
      input.effectId,
    );
  }

  async getBySourceWake(input: {
    userId: string;
    sourceWakeId: string;
  }): Promise<RuntimeEffectRecord | null> {
    const rows = await this.db
      .select({ id: runtimeEffects.id })
      .from(runtimeEffects)
      .where(
        and(
          eq(runtimeEffects.userId, input.userId),
          eq(runtimeEffects.sourceWakeId, input.sourceWakeId),
        ),
      )
      .limit(1);
    const id = rows[0]?.id;
    return id
      ? this.getWithExecutor(this.db, input.userId, id)
      : null;
  }

  async findNextUnknown(input: {
    userId: string;
  }): Promise<RuntimeEffectRecord | null> {
    const rows = await this.db
      .select({ id: runtimeEffects.id })
      .from(runtimeEffects)
      .where(
        and(
          eq(runtimeEffects.userId, input.userId),
          eq(runtimeEffects.status, "unknown"),
        ),
      )
      .orderBy(
        runtimeEffects.updatedAt,
        runtimeEffects.id,
      )
      .limit(1);
    const id = rows[0]?.id;
    return id
      ? this.getWithExecutor(this.db, input.userId, id)
      : null;
  }

  async findNextRetryableFailed(input: {
    userId: string;
  }): Promise<RuntimeEffectRecord | null> {
    const rows = await this.db
      .select({ id: runtimeEffects.id })
      .from(runtimeEffects)
      .where(
        and(
          eq(runtimeEffects.userId, input.userId),
          eq(runtimeEffects.status, "failed"),
          eq(runtimeEffects.retryable, true),
        ),
      )
      .orderBy(
        runtimeEffects.updatedAt,
        runtimeEffects.id,
      )
      .limit(1);
    const id = rows[0]?.id;
    return id
      ? this.getWithExecutor(this.db, input.userId, id)
      : null;
  }

  async reserveNext(input: {
    userId: string;
    workerInstanceId: string;
    leaseMs?: number;
  }): Promise<RuntimeEffectRecord | null> {
    requireUuid(input.workerInstanceId, "workerInstanceId");
    const leaseMs = normalizeLease(
      input.leaseMs,
      DEFAULT_RESERVATION_LEASE_MS,
    );

    return this.db.transaction(async (transaction) => {
      await reclaimExpiredReservations(
        transaction as Transaction,
        input.userId,
      );

      const rows = await transaction.execute<{ id: string }>(sql`
        WITH candidate AS (
          SELECT id
          FROM runtime_effects
          WHERE user_id = ${input.userId}::uuid
            AND status = 'pending'
            AND retryable = true
            AND EXISTS (
              SELECT 1
              FROM conversations AS target_conversation
              WHERE target_conversation.user_id =
                  runtime_effects.user_id
                AND target_conversation.origin = 'native_live'
                AND target_conversation.lifecycle_status = 'active'
                AND runtime_effects.target =
                  'conversation:' || target_conversation.id::text
            )
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE runtime_effects AS effect
        SET status = 'reserved',
            reserved_by = ${input.workerInstanceId}::uuid,
            reserved_at = now(),
            reservation_expires_at =
              now() + ${leaseMs} * interval '1 millisecond',
            updated_at = now()
        FROM candidate
        WHERE effect.id = candidate.id
          AND effect.user_id = ${input.userId}::uuid
          AND effect.status = 'pending'
        RETURNING effect.id
      `);

      const effectId = rows[0]?.id;
      if (!effectId) return null;
      const effect = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        effectId,
      );
      if (!effect) {
        throw new Error(
          "Reserved runtime effect disappeared.",
        );
      }
      return effect;
    });
  }

  async releaseReservation(input: {
    userId: string;
    effectId: string;
    workerInstanceId: string;
  }): Promise<RuntimeEffectRecord> {
    requireUuid(input.workerInstanceId, "workerInstanceId");
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        UPDATE runtime_effects
        SET status = 'pending',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            updated_at = now()
        WHERE id = ${input.effectId}::uuid
          AND user_id = ${input.userId}::uuid
          AND status = 'reserved'
          AND reserved_by = ${input.workerInstanceId}::uuid
      `);
      const current = await this.requireCurrent(
        transaction as Transaction,
        input.userId,
        input.effectId,
      );
      if (current.status === "pending") return current;
      throw new RuntimeEffectRepositoryError(
        "RESERVATION_CONFLICT",
        "Runtime effect reservation is not owned by this worker.",
      );
    });
  }

  async beginDispatch(input: {
    userId: string;
    effectId: string;
    workerInstanceId: string;
    leaseMs?: number;
  }): Promise<RuntimeEffectRecord> {
    requireUuid(input.workerInstanceId, "workerInstanceId");
    const leaseMs = normalizeLease(
      input.leaseMs,
      DEFAULT_DISPATCH_LEASE_MS,
    );

    return this.db.transaction(async (transaction) => {
      const rows = await transaction.execute<{ id: string }>(sql`
        UPDATE runtime_effects
        SET status = 'dispatching',
            attempt = attempt + 1,
            dispatch_started_at = now(),
            reservation_expires_at =
              now() + ${leaseMs} * interval '1 millisecond',
            updated_at = now()
        WHERE id = ${input.effectId}::uuid
          AND user_id = ${input.userId}::uuid
          AND status = 'reserved'
          AND reserved_by = ${input.workerInstanceId}::uuid
          AND reservation_expires_at > now()
        RETURNING id
      `);
      if (rows.length !== 1) {
        throw new RuntimeEffectRepositoryError(
          "RESERVATION_CONFLICT",
          "Runtime effect cannot begin dispatch without a live reservation.",
        );
      }
      return this.requireCurrent(
        transaction as Transaction,
        input.userId,
        input.effectId,
      );
    });
  }

  async completeDispatch(input: {
    userId: string;
    effectId: string;
    workerInstanceId: string;
    result: RuntimeEffectDispatchOutcome;
  }): Promise<RuntimeEffectRecord> {
    requireUuid(input.workerInstanceId, "workerInstanceId");
    const patch = completionPatch(input.result);

    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .update(runtimeEffects)
        .set({
          ...patch,
          reservedBy: null,
          reservedAt: null,
          reservationExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(runtimeEffects.id, input.effectId),
            eq(runtimeEffects.userId, input.userId),
            eq(runtimeEffects.status, "dispatching"),
            eq(
              runtimeEffects.reservedBy,
              input.workerInstanceId,
            ),
          ),
        )
        .returning({ id: runtimeEffects.id });

      if (rows.length !== 1) {
        throw new RuntimeEffectRepositoryError(
          "RESERVATION_CONFLICT",
          "Runtime effect dispatch outcome does not match an active dispatch.",
        );
      }
      return this.requireCurrent(
        transaction as Transaction,
        input.userId,
        input.effectId,
      );
    });
  }

  async requeueFailed(input: {
    userId: string;
    effectId: string;
  }): Promise<RuntimeEffectRecord> {
    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .update(runtimeEffects)
        .set({
          status: "pending",
          dispatchStartedAt: null,
          failureCode: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(runtimeEffects.id, input.effectId),
            eq(runtimeEffects.userId, input.userId),
            eq(runtimeEffects.status, "failed"),
            eq(runtimeEffects.retryable, true),
          ),
        )
        .returning({ id: runtimeEffects.id });
      if (rows.length !== 1) {
        throw new RuntimeEffectRepositoryError(
          "EFFECT_CONFLICT",
          "Runtime effect is not a retryable failure.",
        );
      }
      return this.requireCurrent(
        transaction as Transaction,
        input.userId,
        input.effectId,
      );
    });
  }

  async reconcileUnknown(input: {
    userId: string;
    effectId: string;
    resolution:
      | { outcome: "observed"; observedAt?: string }
      | {
          outcome: "failed";
          failureCode: string;
          retryable: boolean;
        };
  }): Promise<RuntimeEffectRecord> {
    const patch =
      input.resolution.outcome === "observed"
        ? {
            status: "observed" as const,
            retryable: false,
            observedAt: new Date(
              normalizeIso(
                input.resolution.observedAt
                  ?? new Date().toISOString(),
              ),
            ),
            failureCode: null,
            updatedAt: new Date(),
          }
        : {
            status: "failed" as const,
            retryable: input.resolution.retryable,
            observedAt: null,
            failureCode: normalizeFailureCode(
              input.resolution.failureCode,
            ),
            updatedAt: new Date(),
          };

    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .update(runtimeEffects)
        .set(patch)
        .where(
          and(
            eq(runtimeEffects.id, input.effectId),
            eq(runtimeEffects.userId, input.userId),
            eq(runtimeEffects.status, "unknown"),
          ),
        )
        .returning({ id: runtimeEffects.id });
      if (rows.length !== 1) {
        throw new RuntimeEffectRepositoryError(
          "EFFECT_CONFLICT",
          "Only an unknown runtime effect may be reconciled.",
        );
      }
      return this.requireCurrent(
        transaction as Transaction,
        input.userId,
        input.effectId,
      );
    });
  }

  private async requireCurrent(
    executor: Executor,
    userId: string,
    effectId: string,
  ): Promise<RuntimeEffectRecord> {
    const current = await this.getWithExecutor(
      executor,
      userId,
      effectId,
    );
    if (!current) {
      throw new RuntimeEffectRepositoryError(
        "EFFECT_NOT_FOUND",
        "Runtime effect was not found.",
      );
    }
    return current;
  }

  private async getWithExecutor(
    executor: Executor,
    userId: string,
    effectId: string,
  ): Promise<RuntimeEffectRecord | null> {
    const rows = await executor
      .select({
        id: runtimeEffects.id,
        userId: runtimeEffects.userId,
        subjectId: runtimeEffects.subjectId,
        sourceWakeId: runtimeEffects.sourceWakeId,
        decisionId: runtimeEffects.decisionId,
        idempotencyKey: runtimeEffects.idempotencyKey,
        effectType: runtimeEffects.effectType,
        target: runtimeEffects.target,
        payload: runtimeEffects.payload,
        payloadHash: runtimeEffects.payloadHash,
        status: runtimeEffects.status,
        attempt: runtimeEffects.attempt,
        retryable: runtimeEffects.retryable,
        reservedBy: runtimeEffects.reservedBy,
        reservedAt: runtimeEffects.reservedAt,
        reservationExpiresAt:
          runtimeEffects.reservationExpiresAt,
        dispatchStartedAt: runtimeEffects.dispatchStartedAt,
        createdAt: runtimeEffects.createdAt,
        updatedAt: runtimeEffects.updatedAt,
        observedAt: runtimeEffects.observedAt,
        failureCode: runtimeEffects.failureCode,
      })
      .from(runtimeEffects)
      .where(
        and(
          eq(runtimeEffects.id, effectId),
          eq(runtimeEffects.userId, userId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      effectId: row.id,
      userId: row.userId,
      subjectId: row.subjectId,
      sourceWakeId: row.sourceWakeId,
      decisionId: row.decisionId,
      idempotencyKey: row.idempotencyKey,
      effectType: row.effectType,
      target: row.target,
      payload: row.payload,
      payloadHash: row.payloadHash,
      status: row.status as EffectStatus,
      attempt: row.attempt,
      retryable: row.retryable,
      reservedBy: row.reservedBy,
      reservedAt: row.reservedAt?.toISOString() ?? null,
      reservationExpiresAt:
        row.reservationExpiresAt?.toISOString() ?? null,
      dispatchStartedAt:
        row.dispatchStartedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      observedAt: row.observedAt?.toISOString() ?? null,
      failureCode: row.failureCode,
    };
  }
}

async function reclaimExpiredReservations(
  transaction: Transaction,
  userId: string,
): Promise<void> {
  await transaction.execute(sql`
    UPDATE runtime_effects
    SET status = 'pending',
        reserved_by = NULL,
        reserved_at = NULL,
        reservation_expires_at = NULL,
        updated_at = now()
    WHERE user_id = ${userId}::uuid
      AND status = 'reserved'
      AND reservation_expires_at <= now()
  `);

  await transaction.execute(sql`
    UPDATE runtime_effects
    SET status = 'unknown',
        reserved_by = NULL,
        reserved_at = NULL,
        reservation_expires_at = NULL,
        retryable = false,
        failure_code = 'DISPATCH_LEASE_EXPIRED',
        updated_at = now()
    WHERE user_id = ${userId}::uuid
      AND status = 'dispatching'
      AND reservation_expires_at <= now()
  `);
}

function completionPatch(
  result: RuntimeEffectDispatchOutcome,
): {
  status: "observed" | "failed" | "unknown";
  retryable: boolean;
  observedAt: Date | null;
  failureCode: string | null;
} {
  if (result.outcome === "observed") {
    return {
      status: "observed",
      retryable: false,
      observedAt: new Date(
        normalizeIso(
          result.observedAt ?? new Date().toISOString(),
        ),
      ),
      failureCode: null,
    };
  }
  if (result.outcome === "failed") {
    return {
      status: "failed",
      retryable: result.retryable,
      observedAt: null,
      failureCode: normalizeFailureCode(result.failureCode),
    };
  }
  return {
    status: "unknown",
    retryable: false,
    observedAt: null,
    failureCode: normalizeFailureCode(
      result.failureCode ?? "DELIVERY_UNKNOWN",
    ),
  };
}

function normalizeFailureCode(value: string): string {
  const code = value.trim();
  if (!code || code.length > 128) {
    throw new Error(
      "Runtime effect failure code must be 1-128 characters.",
    );
  }
  return code;
}

function normalizeLease(
  value: number | undefined,
  fallback: number,
): number {
  const lease = value ?? fallback;
  if (
    !Number.isInteger(lease)
    || lease <= 0
    || lease > MAX_LEASE_MS
  ) {
    throw new RangeError(
      "Runtime effect lease must be a positive integer no greater than 10 minutes.",
    );
  }
  return lease;
}

function parseConversationTarget(
  target: string,
): string | null {
  const match = target.match(
    /^conversation:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu,
  );
  return match?.[1] ?? null;
}

function requireUuid(value: string, field: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(value)
  ) {
    throw new Error(
      "Runtime effect " + field + " must be a UUID.",
    );
  }
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Runtime effect timestamp must be an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
