import type {
  BackgroundLoopOrchestrator,
} from "../background/background-loop-orchestrator.js";
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


export type RuntimeEffectDeliveryWorkerObserverEvent =
  | { name: "runtime_effect_delivery_observed" }
  | {
      name: "runtime_effect_delivery_unknown";
      failureCode: string;
    }
  | {
      name: "runtime_effect_delivery_failed";
      failureCode: string;
      retryable: boolean;
    }
  | {
      name: "runtime_effect_delivery_reconciled";
      outcome: "observed" | "failed";
      retryable: boolean | null;
    }
  | {
      name: "runtime_effect_delivery_requeued";
      source:
        | "existing_failed"
        | "delivery_failure"
        | "reconciliation_failure";
    };


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
    private readonly observe?: (
      event: RuntimeEffectDeliveryWorkerObserverEvent,
    ) => void,
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
      this.emit({
        name: "runtime_effect_delivery_requeued",
        source: "existing_failed",
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
      this.emit({
        name: "runtime_effect_delivery_unknown",
        failureCode: "DELIVERY_ADAPTER_ERROR",
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
      this.emit({ name: "runtime_effect_delivery_observed" });
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
    this.emit({
      name: "runtime_effect_delivery_failed",
      failureCode: result.failureCode,
      retryable: result.retryable,
    });
    if (
      failed.status === "failed"
      && failed.retryable
    ) {
      await this.coordinator.requeueFailed({
        userId,
        effectId: failed.effectId,
      });
      this.emit({
        name: "runtime_effect_delivery_requeued",
        source: "delivery_failure",
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
    this.emit({
      name: "runtime_effect_delivery_reconciled",
      outcome: result.outcome,
      retryable:
        result.outcome === "failed"
          ? result.retryable
          : null,
    });
    if (
      reconciled.status === "failed"
      && reconciled.retryable
    ) {
      await this.coordinator.requeueFailed({
        userId: effect.userId,
        effectId: effect.effectId,
      });
      this.emit({
        name: "runtime_effect_delivery_requeued",
        source: "reconciliation_failure",
      });
    }
  }

  private emit(
    event: RuntimeEffectDeliveryWorkerObserverEvent,
  ): void {
    try {
      this.observe?.(event);
    } catch {
      // Observability must never change delivery correctness.
    }
  }
}
