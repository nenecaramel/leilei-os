import type { CurrentSubjectStateKind } from "./subject-state-contract.js";

export type MindLifecycleState =
  | "active"
  | "fading"
  | "satisfied"
  | "resolved"
  | "dormant"
  | "archived"
  | "forgotten";

export type MindLifecycleOwnership =
  | "authored"
  | "derived";

export type MindLifecycleDriver =
  | "time_decay"
  | "reinforcement"
  | "recall"
  | "satisfaction"
  | "resolution"
  | "inactivity";

export type ManagedMindLifecycleProfile = {
  management: "managed";
  ownership: MindLifecycleOwnership;
  drivers: readonly MindLifecycleDriver[];
  initialState: MindLifecycleState;
  transitions: Readonly<
    Partial<Record<MindLifecycleState, readonly MindLifecycleState[]>>
  >;
  purgeFrom: readonly MindLifecycleState[];
};

export type MindLifecycleProfile = ManagedMindLifecycleProfile;

/**
 * Architectural lifecycle authority for Subject State kinds.
 *
 * This contract intentionally owns semantics, not tuning:
 * - Claude authors semantic Mind content.
 * - Runtime owns lifecycle transitions and numeric state.
 * - E5 may inform semantic grouping/relevance but never lifecycle.
 * - Numeric thresholds/half-lives remain runtime policy and are not frozen here.
 *
 * Topic is derived-only. Live authored <topic> parsing is retired and new
 * Topic state is produced only by deterministic runtime projection.
 *
 * Dream is fully retired from the Subject State storage/write contract.
 */
export const MIND_LIFECYCLE_PROFILES = {
  memory: {
    management: "managed",
    ownership: "authored",
    drivers: ["time_decay", "reinforcement", "recall"],
    initialState: "active",
    transitions: {
      active: ["fading", "archived"],
      fading: ["active", "archived"],
      archived: ["forgotten"],
    },
    purgeFrom: ["forgotten"],
  },
  feel: {
    management: "managed",
    ownership: "authored",
    drivers: ["time_decay", "reinforcement", "recall"],
    initialState: "active",
    transitions: {
      active: ["fading", "archived"],
      fading: ["active", "archived"],
      archived: ["forgotten"],
    },
    purgeFrom: ["forgotten"],
  },
  drive: {
    management: "managed",
    ownership: "authored",
    drivers: ["reinforcement", "satisfaction", "inactivity"],
    initialState: "active",
    transitions: {
      active: ["satisfied"],
      satisfied: ["active", "dormant"],
      dormant: ["active"],
    },
    purgeFrom: ["dormant"],
  },
  thought: {
    management: "managed",
    ownership: "authored",
    drivers: ["time_decay", "reinforcement"],
    initialState: "active",
    transitions: {
      active: ["dormant"],
      dormant: ["active"],
    },
    purgeFrom: ["dormant"],
  },
  curiosity: {
    management: "managed",
    ownership: "authored",
    drivers: ["reinforcement", "resolution", "inactivity"],
    initialState: "active",
    transitions: {
      active: ["resolved", "dormant"],
      resolved: ["active", "dormant"],
      dormant: ["active"],
    },
    purgeFrom: ["dormant"],
  },
  topic: {
    management: "managed",
    ownership: "derived",
    drivers: ["reinforcement", "inactivity"],
    initialState: "active",
    transitions: {
      active: ["dormant"],
      dormant: ["active"],
    },
    purgeFrom: ["dormant"],
  },
} as const satisfies Record<CurrentSubjectStateKind, MindLifecycleProfile>;

export function mindLifecycleProfile(
  kind: CurrentSubjectStateKind,
): MindLifecycleProfile {
  return MIND_LIFECYCLE_PROFILES[kind];
}

export function isMindLifecycleTransitionAllowed(input: {
  kind: CurrentSubjectStateKind;
  from: MindLifecycleState;
  to: MindLifecycleState;
}): boolean {
  if (input.from === input.to) return true;
  const profile = mindLifecycleProfile(input.kind);
  if (profile.management !== "managed") return false;
  return profile.transitions[input.from]?.includes(input.to) ?? false;
}

export function assertMindLifecycleTransition(input: {
  kind: CurrentSubjectStateKind;
  from: MindLifecycleState;
  to: MindLifecycleState;
}): void {
  if (isMindLifecycleTransitionAllowed(input)) return;
  throw new Error(
    `Invalid ${input.kind} lifecycle transition: ${input.from} -> ${input.to}.`,
  );
}

export function canPurgeMindState(input: {
  kind: CurrentSubjectStateKind;
  state: MindLifecycleState;
}): boolean {
  const profile = mindLifecycleProfile(input.kind);
  return (
    profile.management === "managed"
    && profile.purgeFrom.includes(input.state)
  );
}
