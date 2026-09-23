import {
  CLAUDE_CODE_BACKGROUND_MUTEX,
  subjectStateBackgroundMutexKey,
  type BackgroundLoopOrchestrator,
  type BackgroundLoopPriority,
} from "./background-loop-orchestrator.js";
import type {
  TopicResurfaceThoughtMaterializationResult,
  TopicResurfaceThoughtMaterializationService,
} from "./topic-resurface-thought-materialization.js";

export type TopicResurfaceBackgroundScheduleInput = {
  userId: string;
  subjectId: string;
};

export type TopicResurfaceBackgroundLoopPlan = {
  priority: BackgroundLoopPriority;
  cost: number;
};

export type TopicResurfaceBackgroundObserverEvent =
  | {
      name: "topic_resurface_background_run";
      userId: string;
      subjectId: string;
      result: TopicResurfaceThoughtMaterializationResult;
    }
  | {
      name: "topic_resurface_background_error";
      userId: string;
      subjectId: string;
      errorName: string;
    };

type TopicResurfaceRunner =
  Pick<TopicResurfaceThoughtMaterializationService, "runOnce">;

/**
 * Adapts local model-backed Topic resurfacing onto the shared
 * BackgroundLoopOrchestrator.
 *
 * This class intentionally does not define cadence. External opportunities may
 * schedule work, but the shared orchestrator owns coalescing, bounded-cycle
 * budget, Subject State serialization, and the global Claude Code mutex.
 *
 * Cross-device Topic resurfacing uses a different execution boundary: the
 * backend opportunity only creates durable workflow/model-queue work, while
 * the Mac daemon executes that queue after foreground Native Live work.
 */
export class TopicResurfaceBackgroundTrigger {
  constructor(
    private readonly orchestrator: Pick<
      BackgroundLoopOrchestrator,
      "schedule" | "drain"
    >,
    private readonly runner: TopicResurfaceRunner,
    private readonly candidateLimit: number,
    private readonly plan: TopicResurfaceBackgroundLoopPlan,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly observe?: (
      event: TopicResurfaceBackgroundObserverEvent,
    ) => void,
  ) {
    if (!Number.isInteger(candidateLimit) || candidateLimit < 1) {
      throw new Error(
        "Topic resurface background candidateLimit must be a positive integer.",
      );
    }
    if (!Number.isInteger(plan.cost) || plan.cost < 1) {
      throw new Error(
        "Topic resurface background cost must be a positive integer.",
      );
    }
  }

  schedule(input: TopicResurfaceBackgroundScheduleInput): void {
    const userId = input.userId.trim();
    const subjectId = input.subjectId.trim();
    if (!userId || !subjectId) {
      throw new Error(
        "Topic resurface background identity must not be blank.",
      );
    }

    this.orchestrator.schedule({
      key: "topic-resurface:" + userId + ":\u0000:" + subjectId,
      kind: "topic_resurface",
      priority: this.plan.priority,
      cost: this.plan.cost,
      mutexKeys: [
        subjectStateBackgroundMutexKey({ userId, subjectId }),
        CLAUDE_CODE_BACKGROUND_MUTEX,
      ],
      run: async () => {
        try {
          const result = await this.runner.runOnce({
            userId,
            subjectId,
            now: normalizeIso(this.now()),
            candidateLimit: this.candidateLimit,
          });
          this.emit({
            name: "topic_resurface_background_run",
            userId,
            subjectId,
            result,
          });
        } catch (error) {
          this.emit({
            name: "topic_resurface_background_error",
            userId,
            subjectId,
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

  private emit(event: TopicResurfaceBackgroundObserverEvent): void {
    try {
      this.observe?.(event);
    } catch {
      // Observability must never turn background work into failure.
    }
  }
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Topic resurface background now() must return an ISO timestamp.",
    );
  }
  return new Date(parsed).toISOString();
}
