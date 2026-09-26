import type { NativeLiveConversation } from "../conversation/native-live-conversation-types.js";
import {
  CLAUDE_CODE_BACKGROUND_MUTEX,
  conversationBackgroundMutexKey,
  subjectStateBackgroundMutexKey,
  type BackgroundLoopOrchestrator,
  type BackgroundLoopPriority,
} from "./background-loop-orchestrator.js";
import type {
  DistillationRunResult,
  DistillationService,
} from "./distillation.js";

export type NativeLiveDistillationScheduleInput = {
  userId: string;
  conversationId: string;
};

export interface NativeLiveDistillationTrigger {
  schedule(input: NativeLiveDistillationScheduleInput): void;
}

export interface DistillationConversationReader {
  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null>;
}

export type DistillationBackgroundObserverEvent =
  | {
      name: "distillation_background_run";
      userId: string;
      conversationId: string;
      result: DistillationRunResult;
    }
  | {
      name: "distillation_background_missing_conversation";
      userId: string;
      conversationId: string;
    }
  | {
      name: "distillation_background_error";
      userId: string;
      conversationId: string;
      errorName: string;
    };

export type DistillationBackgroundLoopPlan = {
  priority: BackgroundLoopPriority;
  cost: number;
};

type DistillationRunner = Pick<DistillationService, "runOnce">;

/**
 * Adapts Distillation onto the shared BackgroundLoopOrchestrator.
 *
 * Foreground completion only offers an opportunity; it never waits for model
 * work. Same-conversation opportunities coalesce while pending. Distillation
 * also shares the Subject State mutex with maintenance jobs and the global
 * Claude Code background mutex with other model-backed background work.
 */
export class DistillationBackgroundTrigger
implements NativeLiveDistillationTrigger {
  constructor(
    private readonly orchestrator: Pick<
      BackgroundLoopOrchestrator,
      "schedule" | "drain"
    >,
    private readonly conversations: DistillationConversationReader,
    private readonly distillation: DistillationRunner,
    private readonly subjectId: string,
    private readonly plan: DistillationBackgroundLoopPlan,
    private readonly observe?: (
      event: DistillationBackgroundObserverEvent,
    ) => void,
  ) {
    if (!subjectId.trim()) {
      throw new Error("Distillation background subjectId must not be blank.");
    }
    if (!Number.isInteger(plan.cost) || plan.cost < 1) {
      throw new Error(
        "Distillation background cost must be a positive integer.",
      );
    }
  }

  schedule(input: NativeLiveDistillationScheduleInput): void {
    const userId = input.userId.trim();
    const conversationId = input.conversationId.trim();
    if (!userId || !conversationId) {
      throw new Error(
        "Distillation background identity must not be blank.",
      );
    }

    this.orchestrator.schedule({
      key:
        "distillation:"
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
        CLAUDE_CODE_BACKGROUND_MUTEX,
      ],
      run: async () => {
        try {
          const conversation = await this.conversations.getConversation({
            userId,
            conversationId,
          });
          if (!conversation) {
            this.emit({
              name: "distillation_background_missing_conversation",
              userId,
              conversationId,
            });
            return;
          }

          const result = await this.distillation.runOnce({
            userId,
            subjectId: this.subjectId,
            conversation,
          });
          this.emit({
            name: "distillation_background_run",
            userId,
            conversationId,
            result,
          });
        } catch (error) {
          this.emit({
            name: "distillation_background_error",
            userId,
            conversationId,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          throw error;
        }
      },
    });
  }

  async drain(): Promise<void> {
    await this.orchestrator.drain();
  }

  private emit(event: DistillationBackgroundObserverEvent): void {
    try {
      this.observe?.(event);
    } catch {
      // Observability must never turn background work into failure.
    }
  }
}
