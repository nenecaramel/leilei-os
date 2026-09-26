import type { CurrentSubjectStateKind } from "./subject-state-contract.js";

export type MindRetirementKind =
  Extract<CurrentSubjectStateKind, "drive" | "thought" | "curiosity" | "topic">;

export type MindRetirementPrecondition =
  | "dormant"
  | "resolved_or_dormant";

export const MIND_RETIREMENT_PRECONDITIONS = {
  drive: "dormant",
  thought: "dormant",
  curiosity: "resolved_or_dormant",
  topic: "dormant",
} as const satisfies Record<MindRetirementKind, MindRetirementPrecondition>;

export type MindRetirementRule = {
  retentionHours: number;
};

export type MindRetirementPolicy =
  Partial<Record<MindRetirementKind, MindRetirementRule>>;

/**
 * Retirement is deliberately policy-less by default.
 *
 * Lifecycle code may move a state into its terminal inactive phase without
 * making that state eligible for physical deletion. A kind is retirement
 * eligible only when an explicit positive retention window is supplied.
 */
export function validateMindRetirementPolicy(
  policy: MindRetirementPolicy,
): MindRetirementPolicy {
  const validated: MindRetirementPolicy = {};

  for (const kind of Object.keys(policy) as MindRetirementKind[]) {
    const rule = policy[kind];
    if (!rule) continue;
    if (
      typeof rule.retentionHours !== "number"
      || !Number.isFinite(rule.retentionHours)
      || rule.retentionHours <= 0
    ) {
      throw new Error(
        "Mind retirement " + kind
        + " retentionHours must be positive.",
      );
    }
    validated[kind] = {
      retentionHours: rule.retentionHours,
    };
  }

  return validated;
}
