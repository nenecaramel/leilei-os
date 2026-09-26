import type {
  NativeLiveDistillationScheduleInput,
  NativeLiveDistillationTrigger,
} from "./distillation-trigger-contract.js";
import type {
  BackgroundOpportunityPolicy,
} from "./background-opportunity-policy.js";

export type NativeLiveBackgroundOpportunityInput =
  NativeLiveDistillationScheduleInput;

export interface NativeLiveBackgroundOpportunity {
  schedule(input: NativeLiveBackgroundOpportunityInput): void;
}

/**
 * One durable post-turn opportunity.
 *
 * Immediate Subject State correctness is owned by settlement catch-up. Time
 * based Thought / Drive / Topic maintenance is therefore not scheduled here;
 * it belongs to maintenance_pulse. Post-turn is currently only a
 * consolidation opportunity for Distillation.
 */
export class NativeLivePostTurnBackgroundOpportunity
implements NativeLiveBackgroundOpportunity {
  constructor(
    private readonly distillation: Pick<
      NativeLiveDistillationTrigger,
      "schedule"
    > | null,
    private readonly policy: Pick<
      BackgroundOpportunityPolicy,
      "decide"
    >,
  ) {}

  schedule(input: NativeLiveBackgroundOpportunityInput): void {
    const decision = this.policy.decide({
      opportunity: "post_turn",
    });
    if (
      !decision.targets.some(
        (target) => target.kind === "distillation",
      )
    ) {
      return;
    }

    try {
      this.distillation?.schedule(input);
    } catch {
      // Background opportunity scheduling never changes foreground outcome.
    }
  }
}
