import { and, eq } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { runtimeEffects } from "../../database/schema.js";
import type { DurableEffect } from "./effect-protocol.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type RuntimeEffectPayload = Record<string, unknown>;

export type RuntimeEffectRecord = DurableEffect & {
  sourceWakeId: string;
  payload: RuntimeEffectPayload;
};

export type RuntimeEffectCreate = {
  effect: DurableEffect;
  sourceWakeId: string;
  payload: RuntimeEffectPayload;
};

export interface RuntimeEffectPort {
  createOrGet(
    input: RuntimeEffectCreate,
  ): Promise<RuntimeEffectRecord>;

  getBySourceWake(input: {
    userId: string;
    sourceWakeId: string;
  }): Promise<RuntimeEffectRecord | null>;
}

export class DrizzleRuntimeEffectRepository
implements RuntimeEffectPort {
  constructor(private readonly db: Database) {}

  async createOrGet(
    input: RuntimeEffectCreate,
  ): Promise<RuntimeEffectRecord> {
    await this.db
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

    const current = await this.getBySourceWake({
      userId: input.effect.userId,
      sourceWakeId: input.sourceWakeId,
    });
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
      || JSON.stringify(current.payload) !== JSON.stringify(input.payload)
    ) {
      throw new Error(
        "Runtime effect idempotency key conflicts with existing durable state.",
      );
    }
    return current;
  }

  async getBySourceWake(input: {
    userId: string;
    sourceWakeId: string;
  }): Promise<RuntimeEffectRecord | null> {
    const rows = await this.db
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
        createdAt: runtimeEffects.createdAt,
        updatedAt: runtimeEffects.updatedAt,
        observedAt: runtimeEffects.observedAt,
        failureCode: runtimeEffects.failureCode,
      })
      .from(runtimeEffects)
      .where(
        and(
          eq(runtimeEffects.userId, input.userId),
          eq(runtimeEffects.sourceWakeId, input.sourceWakeId),
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
      status: row.status,
      attempt: row.attempt,
      retryable: row.retryable,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      observedAt: row.observedAt?.toISOString() ?? null,
      failureCode: row.failureCode,
    };
  }
}
