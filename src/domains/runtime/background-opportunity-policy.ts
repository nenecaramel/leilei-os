import type {
  BackgroundLoopKind,
  BackgroundLoopPriority,
} from "./background-loop-orchestrator.js";

export type BackgroundOpportunityKind =
  | "post_turn"
  | "maintenance_pulse"
  | "mac_idle";

export type BackgroundOpportunityTarget =
  Exclude<BackgroundLoopKind, never>;

export type BackgroundOpportunityTargetPlan = {
  kind: BackgroundOpportunityTarget;
  priority: BackgroundLoopPriority;
  cost: number;
};

export type BackgroundOpportunityDecision = {
  opportunity: BackgroundOpportunityKind;
  targets: readonly BackgroundOpportunityTargetPlan[];
};

export type BackgroundOpportunityPolicyConfig = {
  maintenancePulseIntervalMs: number;
  decayEnabled: boolean;
  proactivityWakeEnabled: boolean;
  topicResurfaceEnabled: boolean;
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
 * Single production routing policy for background opportunities.
 *
 * It decides what may become runnable; it does not run jobs, own timers,
 * persist scheduler history, or duplicate domain-level due checks.
 *
 * Breath is intentionally absent: Breath is bounded Context Assembly recall,
 * not an independently scheduled background process.
 */
export class BackgroundOpportunityPolicy {
  constructor(
    private readonly config: BackgroundOpportunityPolicyConfig,
  ) {
    requirePositiveCadence(
      "maintenance_pulse",
      config.maintenancePulseIntervalMs,
    );
  }

  decide(input: {
    opportunity: BackgroundOpportunityKind;
  }): BackgroundOpportunityDecision {
    switch (input.opportunity) {
      case "post_turn":
        return {
          opportunity: input.opportunity,
          targets: [DEFAULT_BACKGROUND_TARGET_PLANS.distillation],
        };

      case "maintenance_pulse":
        return {
          opportunity: input.opportunity,
          targets: [
            ...(this.config.decayEnabled
              ? [DEFAULT_BACKGROUND_TARGET_PLANS.decay]
              : []),
            DEFAULT_BACKGROUND_TARGET_PLANS.thoughtEvolution,
            DEFAULT_BACKGROUND_TARGET_PLANS.driveEvolution,
            DEFAULT_BACKGROUND_TARGET_PLANS.topicLifecycle,
            ...(this.config.proactivityWakeEnabled
              ? [DEFAULT_BACKGROUND_TARGET_PLANS.proactivityWake]
              : []),
          ],
        };

      case "mac_idle":
        return {
          opportunity: input.opportunity,
          targets: this.config.topicResurfaceEnabled
            ? [DEFAULT_BACKGROUND_TARGET_PLANS.topicResurface]
            : [],
        };
    }
  }

  cadenceMs(
    opportunity: BackgroundOpportunityKind,
  ): number | null {
    switch (opportunity) {
      case "post_turn":
        return null;
      case "maintenance_pulse":
        return this.config.maintenancePulseIntervalMs;
      case "mac_idle":
        // Mac Companion owns idle cadence. Policy only decides eligibility.
        return null;
    }
  }

  plan(
    opportunity: BackgroundOpportunityKind,
    target: BackgroundOpportunityTarget,
  ): BackgroundOpportunityTargetPlan | null {
    return this.decide({ opportunity }).targets.find(
      (candidate) => candidate.kind === target,
    ) ?? null;
  }
}


function requirePositiveCadence(
  opportunity: BackgroundOpportunityKind,
  value: number,
): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      "Background opportunity " + opportunity
      + " cadence must be positive and finite.",
    );
  }
}
