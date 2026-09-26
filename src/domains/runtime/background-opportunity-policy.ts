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
  mindRetirementEnabled: boolean;
};

export const DEFAULT_BACKGROUND_TARGET_PLANS = {
  distillation: {
    kind: "distillation",
    priority: "consolidation",
    cost: 1,
  },
  decay: {
    kind: "decay",
    priority: "maintenance",
    cost: 1,
  },
  thoughtEvolution: {
    kind: "thought_evolution",
    priority: "maintenance",
    cost: 1,
  },
  driveEvolution: {
    kind: "drive_evolution",
    priority: "maintenance",
    cost: 1,
  },
  topicLifecycle: {
    kind: "topic_lifecycle",
    priority: "maintenance",
    cost: 1,
  },
  mindRetirement: {
    kind: "mind_retirement",
    priority: "maintenance",
    cost: 1,
  },
  topicResurface: {
    kind: "topic_resurface",
    priority: "reflection",
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
 * This policy now answers one narrow question only: which Subject State
 * maintenance jobs are eligible when Companion offers a timed opportunity.
 * Post-turn Distillation, Topic resurfacing, Proactivity and effect recovery
 * already have explicit producers and do not need a second routing policy.
 */
export class BackgroundOpportunityPolicy {
  constructor(
    private readonly config: BackgroundOpportunityPolicyConfig,
  ) {}

  decide(): BackgroundOpportunityDecision {
    return {
      opportunity: "companion_due",
      targets: [
        ...(this.config.decayEnabled
          ? [DEFAULT_BACKGROUND_TARGET_PLANS.decay]
          : []),
        DEFAULT_BACKGROUND_TARGET_PLANS.thoughtEvolution,
        DEFAULT_BACKGROUND_TARGET_PLANS.driveEvolution,
        DEFAULT_BACKGROUND_TARGET_PLANS.topicLifecycle,
        ...(this.config.mindRetirementEnabled
          ? [DEFAULT_BACKGROUND_TARGET_PLANS.mindRetirement]
          : []),
      ],
    };
  }
}
