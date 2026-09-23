import type {
  NativeLiveDistillationScheduleInput,
  NativeLiveDistillationTrigger,
} from "./distillation-background-trigger.js";
import type {
  SubjectStateBackgroundMaintenance,
} from "./subject-state-background-maintenance.js";

export type NativeLiveBackgroundOpportunityInput =
  NativeLiveDistillationScheduleInput;

export interface NativeLiveBackgroundOpportunity {
  schedule(input: NativeLiveBackgroundOpportunityInput): void;
}

/**
 * One post-turn opportunity fan-out.
 *
 * It is deliberately not a scheduler: no timer, cadence, retries, or durable
 * history live here. Each target owns its own coalescing / budget semantics in
 * the shared BackgroundLoopOrchestrator. Scheduling failures are fail-soft so
 * a completed foreground turn cannot be converted into failure.
 */
export class NativeLivePostTurnBackgroundOpportunity
implements NativeLiveBackgroundOpportunity {
  constructor(
    private readonly distillation: Pick<
      NativeLiveDistillationTrigger,
      "schedule"
    > | null,
    private readonly subjectMaintenance: Pick<
      SubjectStateBackgroundMaintenance,
      "schedule"
    > | null,
  ) {}

  schedule(input: NativeLiveBackgroundOpportunityInput): void {
    try {
      this.distillation?.schedule(input);
    } catch {
      // Background opportunity scheduling never changes foreground outcome.
    }

    try {
      this.subjectMaintenance?.schedule({
        userId: input.userId,
      });
    } catch {
      // Background opportunity scheduling never changes foreground outcome.
    }
  }
}
