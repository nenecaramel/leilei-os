import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import type {
  BackgroundLoopOrchestrator,
} from "./background-loop-orchestrator.js";
import type {
  RuntimeEffectDeliveryCoordinator,
} from "./runtime-effect-delivery-coordinator.js";
import type {
  RuntimeEffectPort,
  RuntimeEffectRecord,
} from "./runtime-effect-repository.js";
import type {
  RuntimeMessageEffectDeliveryAdapter,
  RuntimeMessageEffectDeliveryResult,
} from "./runtime-message-effect-delivery-adapter.js";

type Database = ReturnType<typeof createDatabase>["db"];

export interface RuntimeEffectDeliveryUserSource {
  listCandidateUserIds(input: {
    limit: number;
  }): Promise<string[]>;
}

export class DrizzleRuntimeEffectDeliveryUserSource
implements RuntimeEffectDeliveryUserSource {
  constructor(private readonly db: Database) {}

  async listCandidateUserIds(input: {
    limit: number;
  }): Promise<string[]> {
    if (
      !Number.isInteger(input.limit)
      || input.limit <= 0
      || input.limit > 1_000
    ) {
      throw new Error(
        "Runtime effect delivery user limit must be 1-1000.",
      );
    }

    const rows = await this.db.execute<{ user_id: string }>(sql`
      SELECT user_id
      FROM runtime_effects
      WHERE (
        status IN (
          'pending',
          'reserved',
          'dispatching',
          'unknown'
        )
        OR (status = 'failed' AND retryable = true)
      )
      GROUP BY user_id
      ORDER BY min(created_at) ASC, user_id ASC
      LIMIT ${input.limit}
    `);
    return rows.map((row) => row.user_id);
  }
}

export class RuntimeEffectDeliveryWorker {
  constructor(
    private readonly orchestrator: Pick<
      BackgroundLoopOrchestrator,
      "schedule"
    >,
    private readonly effects: Pick<
      RuntimeEffectPort,
      "findNextUnknown" | "findNextRetryableFailed"
    >,
    private readonly coordinator: Pick<
      RuntimeEffectDeliveryCoordinator,
      | "reserveNext"
      | "beginDispatch"
      | "completeDispatch"
      | "reconcileUnknown"
      | "requeueFailed"
    >,
    private readonly adapter: Pick<
      RuntimeMessageEffectDeliveryAdapter,
      "deliver" | "reconcile"
    >,
    private readonly workerInstanceId: string,
  ) {}

  scheduleUser(userId: string): void {
    this.orchestrator.schedule({
      key: "runtime-effect-delivery:" + userId,
      kind: "effect_delivery",
      priority: "reflection",
      cost: 1,
      mutexKeys: ["runtime-effect-delivery:" + userId],
      run: () => this.runOne(userId),
    });
  }

  async runOne(userId: string): Promise<void> {
    const unknown =
      await this.effects.findNextUnknown({ userId });
    if (unknown) {
      await this.reconcileUnknown(unknown);
      return;
    }

    const retryableFailed =
      await this.effects.findNextRetryableFailed({ userId });
    if (retryableFailed) {
      await this.coordinator.requeueFailed({
        userId,
        effectId: retryableFailed.effectId,
      });
      return;
    }

    const reserved = await this.coordinator.reserveNext({
      userId,
      workerInstanceId: this.workerInstanceId,
    });
    if (reserved.outcome !== "reserved") {
      if (reserved.outcome === "idle") {
        const reclaimedUnknown =
          await this.effects.findNextUnknown({ userId });
        if (reclaimedUnknown) {
          await this.reconcileUnknown(reclaimedUnknown);
        }
      }
      return;
    }

    const begun = await this.coordinator.beginDispatch({
      userId,
      effectId: reserved.effect.effectId,
      workerInstanceId: this.workerInstanceId,
    });
    if (begun.outcome !== "dispatching") return;

    let result: RuntimeMessageEffectDeliveryResult;
    try {
      result = await this.adapter.deliver({
        effect: begun.effect,
        workerInstanceId: this.workerInstanceId,
      });
    } catch {
      await this.coordinator.completeDispatch({
        userId,
        effectId: begun.effect.effectId,
        workerInstanceId: this.workerInstanceId,
        result: {
          outcome: "unknown",
          failureCode: "DELIVERY_ADAPTER_ERROR",
        },
      });
      return;
    }

    if (result.outcome === "observed") {
      await this.coordinator.completeDispatch({
        userId,
        effectId: begun.effect.effectId,
        workerInstanceId: this.workerInstanceId,
        result: { outcome: "observed" },
      });
      return;
    }

    const failed =
      await this.coordinator.completeDispatch({
        userId,
        effectId: begun.effect.effectId,
        workerInstanceId: this.workerInstanceId,
        result: {
          outcome: "failed",
          failureCode: result.failureCode,
          retryable: result.retryable,
        },
      });
    if (
      failed.status === "failed"
      && failed.retryable
    ) {
      await this.coordinator.requeueFailed({
        userId,
        effectId: failed.effectId,
      });
    }
  }

  private async reconcileUnknown(
    effect: RuntimeEffectRecord,
  ): Promise<void> {
    const result = await this.adapter.reconcile({ effect });
    const reconciled =
      await this.coordinator.reconcileUnknown({
        userId: effect.userId,
        effectId: effect.effectId,
        resolution:
          result.outcome === "observed"
            ? { outcome: "observed" }
            : {
                outcome: "failed",
                failureCode: result.failureCode,
                retryable: result.retryable,
              },
      });
    if (
      reconciled.status === "failed"
      && reconciled.retryable
    ) {
      await this.coordinator.requeueFailed({
        userId: effect.userId,
        effectId: effect.effectId,
      });
    }
  }
}

export class RuntimeEffectDeliveryRecovery {
  constructor(
    private readonly source: RuntimeEffectDeliveryUserSource,
    private readonly worker: Pick<
      RuntimeEffectDeliveryWorker,
      "scheduleUser"
    >,
    private readonly userLimit: number,
  ) {
    if (
      !Number.isInteger(userLimit)
      || userLimit <= 0
      || userLimit > 1_000
    ) {
      throw new Error(
        "Runtime effect recovery userLimit must be 1-1000.",
      );
    }
  }

  async schedulePulse(): Promise<number> {
    const userIds = await this.source.listCandidateUserIds({
      limit: this.userLimit,
    });
    for (const userId of userIds) {
      this.worker.scheduleUser(userId);
    }
    return userIds.length;
  }
}
