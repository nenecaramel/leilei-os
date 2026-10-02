import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  assertEffectDispatchAllowed,
  assertEffectRequeueAllowed,
  assertEffectUnknownReconciliationAllowed,
} from "./effect-protocol.js";
import type {
  RuntimeEffectDispatchOutcome,
  RuntimeEffectPort,
  RuntimeEffectRecord,
} from "./runtime-effect-repository.js";

type Database = ReturnType<typeof createDatabase>["db"];

export interface RuntimeEffectForegroundGuard {
  isForegroundActive(input: {
    userId: string;
  }): Promise<boolean>;
}

export class DrizzleRuntimeEffectForegroundGuard
implements RuntimeEffectForegroundGuard {
  constructor(private readonly db: Database) {}

  async isForegroundActive(input: {
    userId: string;
  }): Promise<boolean> {
    const rows = await this.db.execute<{ active: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM native_live_turn_preparations
        WHERE user_id = ${input.userId}::uuid
          AND dispatch_status IN (
            'staged',
            'pending',
            'reserved',
            'executing',
            'delivery_unknown'
          )
      ) AS active
    `);
    return rows[0]?.active ?? false;
  }
}

export type RuntimeEffectReserveResult =
  | { outcome: "foreground_active" }
  | { outcome: "idle" }
  | {
      outcome: "reserved";
      effect: RuntimeEffectRecord;
    };

export type RuntimeEffectBeginResult =
  | { outcome: "foreground_active" }
  | {
      outcome: "dispatching";
      effect: RuntimeEffectRecord;
    };

export class RuntimeEffectDeliveryCoordinator {
  constructor(
    private readonly effects: RuntimeEffectPort,
    private readonly foreground:
      RuntimeEffectForegroundGuard,
  ) {}

  async reserveNext(input: {
    userId: string;
    workerInstanceId: string;
  }): Promise<RuntimeEffectReserveResult> {
    if (
      await this.foreground.isForegroundActive({
        userId: input.userId,
      })
    ) {
      return { outcome: "foreground_active" };
    }

    const effect = await this.effects.reserveNext(input);
    return effect
      ? { outcome: "reserved", effect }
      : { outcome: "idle" };
  }

  async beginDispatch(input: {
    userId: string;
    effectId: string;
    workerInstanceId: string;
  }): Promise<RuntimeEffectBeginResult> {
    if (
      await this.foreground.isForegroundActive({
        userId: input.userId,
      })
    ) {
      await this.effects.releaseReservation(input);
      return { outcome: "foreground_active" };
    }

    const reserved = await this.effects.get({
      userId: input.userId,
      effectId: input.effectId,
    });
    if (!reserved) {
      throw new Error(
        "Runtime effect was not found before dispatch.",
      );
    }
    assertEffectDispatchAllowed({
      mode: "live",
      effect: reserved,
    });

    const effect = await this.effects.beginDispatch(input);
    return {
      outcome: "dispatching",
      effect,
    };
  }

  completeDispatch(input: {
    userId: string;
    effectId: string;
    workerInstanceId: string;
    result: RuntimeEffectDispatchOutcome;
  }): Promise<RuntimeEffectRecord> {
    return this.effects.completeDispatch(input);
  }

  async requeueFailed(input: {
    userId: string;
    effectId: string;
  }): Promise<RuntimeEffectRecord> {
    const effect = await this.requireEffect(input);
    assertEffectRequeueAllowed(effect);
    return this.effects.requeueFailed(input);
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
    const effect = await this.requireEffect(input);
    assertEffectUnknownReconciliationAllowed(effect);
    return this.effects.reconcileUnknown(input);
  }

  private async requireEffect(input: {
    userId: string;
    effectId: string;
  }): Promise<RuntimeEffectRecord> {
    const effect = await this.effects.get(input);
    if (!effect) {
      throw new Error("Runtime effect was not found.");
    }
    return effect;
  }
}
