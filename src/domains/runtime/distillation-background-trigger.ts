import type { NativeLiveConversation } from "../conversation/native-live-conversation-types.js";
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

type DistillationRunner = Pick<DistillationService, "runOnce">;

/**
 * Best-effort V1 background trigger.
 *
 * A completed foreground turn only schedules work; it never waits for
 * Distillation. The worker is globally serial and coalesces repeated triggers
 * per conversation. If a run fails, the foreground chat remains successful and
 * the watermark stays put, so a later trigger can safely retry the same source.
 */
export class DistillationBackgroundTrigger
implements NativeLiveDistillationTrigger {
  private readonly pending = new Map<
    string,
    NativeLiveDistillationScheduleInput
  >();
  private worker: Promise<void> | null = null;

  constructor(
    private readonly conversations: DistillationConversationReader,
    private readonly distillation: DistillationRunner,
    private readonly subjectId: string,
    private readonly observe?: (
      event: DistillationBackgroundObserverEvent,
    ) => void,
  ) {
    if (!subjectId.trim()) {
      throw new Error("Distillation background subjectId must not be blank.");
    }
  }

  schedule(input: NativeLiveDistillationScheduleInput): void {
    this.pending.set(keyOf(input), input);
    this.ensureWorker();
  }

  async drain(): Promise<void> {
    for (;;) {
      const active = this.worker;
      if (!active) {
        if (this.pending.size === 0) return;
        this.ensureWorker();
        continue;
      }
      await active;
    }
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = Promise.resolve()
      .then(() => this.runLoop())
      .finally(() => {
        this.worker = null;
        if (this.pending.size > 0) this.ensureWorker();
      });
  }

  private async runLoop(): Promise<void> {
    while (this.pending.size > 0) {
      const first = this.pending.entries().next().value as
        | [string, NativeLiveDistillationScheduleInput]
        | undefined;
      if (!first) return;

      const [key, input] = first;
      this.pending.delete(key);

      try {
        const conversation = await this.conversations.getConversation(input);
        if (!conversation) {
          this.emit({
            name: "distillation_background_missing_conversation",
            ...input,
          });
          continue;
        }

        const result = await this.distillation.runOnce({
          userId: input.userId,
          subjectId: this.subjectId,
          conversation,
        });
        this.emit({
          name: "distillation_background_run",
          ...input,
          result,
        });
      } catch (error) {
        this.emit({
          name: "distillation_background_error",
          ...input,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
  }

  private emit(event: DistillationBackgroundObserverEvent): void {
    try {
      this.observe?.(event);
    } catch {
      // Observability must never turn a background failure into chat failure.
    }
  }
}

function keyOf(input: NativeLiveDistillationScheduleInput): string {
  return `${input.userId}:\u0000:${input.conversationId}`;
}
