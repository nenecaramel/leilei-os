import {
  conversationBackgroundMutexKey,
  subjectStateBackgroundMutexKey,
  type BackgroundLoopOrchestrator,
  type BackgroundLoopPriority,
} from "./background-loop-orchestrator.js";
import type {
  DistillationCrossDeviceCoordinator,
  DistillationCrossDeviceResult,
} from "./distillation-cross-device-coordinator.js";
import type {
  NativeLiveDistillationScheduleInput,
  NativeLiveDistillationTrigger,
} from "./distillation-trigger-contract.js";

export type DistillationCrossDeviceBackgroundObserverEvent =
  | {
      name: "distillation_cross_device_background_run";
      userId: string;
      conversationId: string;
      result: DistillationCrossDeviceResult;
    }
  | {
      name: "distillation_cross_device_background_error";
      userId: string;
      conversationId: string;
      errorName: string;
    };

type Coordinator = Pick<DistillationCrossDeviceCoordinator, "start">;

export class DistillationCrossDeviceBackgroundTrigger
implements NativeLiveDistillationTrigger {
  constructor(
    private readonly orchestrator: Pick<
      BackgroundLoopOrchestrator,
      "schedule" | "drain"
    >,
    private readonly coordinator: Coordinator,
    private readonly subjectId: string,
    private readonly plan: {
      priority: BackgroundLoopPriority;
      cost: number;
    },
    private readonly observe?: (
      event: DistillationCrossDeviceBackgroundObserverEvent,
    ) => void,
  ) {
    if (!subjectId.trim()) {
      throw new Error(
        "Cross-device Distillation subjectId must not be blank.",
      );
    }
    if (!Number.isInteger(plan.cost) || plan.cost < 1) {
      throw new Error(
        "Cross-device Distillation cost must be a positive integer.",
      );
    }
  }

  schedule(input: NativeLiveDistillationScheduleInput): void {
    const userId = input.userId.trim();
    const conversationId = input.conversationId.trim();
    if (!userId || !conversationId) {
      throw new Error(
        "Cross-device Distillation identity must not be blank.",
      );
    }

    this.orchestrator.schedule({
      key:
        "distillation-xdevice:"
        + userId
        + ":\u0000:"
        + conversationId,
      kind: "distillation",
      priority: this.plan.priority,
      cost: this.plan.cost,
      mutexKeys: [
        subjectStateBackgroundMutexKey({
          userId,
          subjectId: this.subjectId,
        }),
        conversationBackgroundMutexKey({
          userId,
          conversationId,
        }),
      ],
      run: async () => {
        try {
          const result = await this.coordinator.start({
            userId,
            subjectId: this.subjectId,
            conversationId,
          });
          this.emit({
            name: "distillation_cross_device_background_run",
            userId,
            conversationId,
            result,
          });
        } catch (error) {
          this.emit({
            name: "distillation_cross_device_background_error",
            userId,
            conversationId,
            errorName:
              error instanceof Error ? error.name : "UnknownError",
          });
          throw error;
        }
      },
    });
  }

  async drain(): Promise<void> {
    await this.orchestrator.drain();
  }

  private emit(
    event: DistillationCrossDeviceBackgroundObserverEvent,
  ): void {
    try {
      this.observe?.(event);
    } catch {
      // Observability cannot change foreground/background correctness.
    }
  }
}
