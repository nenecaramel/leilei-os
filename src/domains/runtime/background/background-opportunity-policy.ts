import type {
  BackgroundLoopKind,
  BackgroundLoopPriority,
} from "./background-loop-orchestrator.js";

export type BackgroundOpportunityTarget =
  Exclude<BackgroundLoopKind, never>;

export type BackgroundOpportunityTargetPlan = {
  kind: BackgroundOpportunityTarget;
  priority: BackgroundLoopPriority;
  cost: number;
};

export type BackgroundOpportunityDecision = {
  opportunity: "companion_due";
  targets: readonly BackgroundOpportunityTargetPlan[];
};

export type BackgroundOpportunityPolicyConfig = {
  decayEnabled: boolean;
};

export const DEFAULT_BACKGROUND_TARGET_PLANS = {
  decay: {
    kind: "decay",
    priority: "maintenance",
    cost: 1,
  },
  proactivityWake: {
    kind: "proactivity_wake",
    priority: "reflection",
    cost: 1,
  },
} as const satisfies Record<
  string,
  BackgroundOpportunityTargetPlan
>;

/**
 * Companion owns timed background cadence.
 *
 * This policy answers one narrow question only: which Subject State
 * maintenance jobs are eligible when Companion offers a timed opportunity.
 * Proactivity and effect recovery already have explicit producers and do not
 * need a second routing policy.
 */
export class BackgroundOpportunityPolicy {
  constructor(
    private readonly config: BackgroundOpportunityPolicyConfig,
  ) {}

  decide(): BackgroundOpportunityDecision {
    return {
      opportunity: "companion_due",
      targets: this.config.decayEnabled
        ? [DEFAULT_BACKGROUND_TARGET_PLANS.decay]
        : [],
    };
  }
}
