import { createHash } from "node:crypto";
import type {
  SubjectStateEvolutionRunMode,
} from "./subject-state-evolution-contract.js";
import type {
  MindSemanticGroupingService,
  MindSemanticThreadGroup,
} from "./mind-semantic-grouping.js";

export type ThoughtPhase = "active" | "dormant";
export type ThoughtEvolutionRole = "anchor" | "reinforcement";

export type ThoughtEvolutionState = {
  phase: ThoughtPhase;
  role: ThoughtEvolutionRole;
  threadKey: string;
  anchorStateId: string;
  strength: number;
  reinforcementCount: number;
  reinforcementSources: string[];
  lastEvolvedAt: string;
  lastReinforcedAt: string;
  dormantAt: string | null;
};

export type ThoughtEvolutionPolicy = {
  halfLifeHours: number;
  baseStrength: number;
  reinforcementBoost: number;
  dormantBelowStrength?: number;
  minEvolutionIntervalHours: number;
  maxReinforcementSources: number;
};

export type ThoughtEvolutionCandidate = {
  stateId: string;
  text: string;
  payload: Record<string, unknown> | null;
  sourceId: string;
  createdAt: string;
  updatedAt: string;
};

export type ThoughtEvolutionUpdate = {
  stateId: string;
  expectedUpdatedAt: string;
  expectedPayload: Record<string, unknown> | null;
  nextPayload: Record<string, unknown>;
  evolution: ThoughtEvolutionState;
  reason:
    | "initialize"
    | "decay"
    | "reinforce"
    | "dormant"
    | "reactivate";
};

export interface ThoughtEvolutionRuntimePort {
  listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<ThoughtEvolutionCandidate[]>;

  applyUpdates(input: {
    userId: string;
    subjectId: string;
    updates: readonly ThoughtEvolutionUpdate[];
  }): Promise<{ applied: number; conflicts: number }>;
}

export type ThoughtEvolutionRunResult = {
  scanned: number;
  threads: number;
  applied: number;
  conflicts: number;
  initialized: number;
  reinforced: number;
  decayed: number;
  dormantTransitions: number;
  reactivated: number;
  active: number;
  dormant: number;
};

const THOUGHT_KEY = "thought_v1";

export class ThoughtEvolutionService {
  constructor(
    private readonly port: ThoughtEvolutionRuntimePort,
    private readonly policy: ThoughtEvolutionPolicy,
    private readonly semanticGrouping:
      Pick<MindSemanticGroupingService, "reconcile"> | null = null,
  ) {
    validatePolicy(policy);
  }

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
    mode?: SubjectStateEvolutionRunMode;
  }): Promise<ThoughtEvolutionRunResult> {
    const now = normalizeIso(input.now, "now");
    const candidates = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: input.limit ?? 500,
    });

    const exactGroups = groupCandidates(candidates);
    const grouped = await this.reconcileSemanticGroups(
      input.userId,
      input.subjectId,
      exactGroups,
    );
    const updates: ThoughtEvolutionUpdate[] = [];
    let active = 0;
    let dormant = 0;
    for (const [threadKey, group] of grouped) {
      const evaluated = evaluateThread(
        group,
        now,
        this.policy,
        threadKey,
      );
      updates.push(...evaluated.updates);
      if (evaluated.phase === "active") active += 1;
      else dormant += 1;
    }

    const selectedUpdates =
      input.mode === "settlement_catch_up"
        ? updates.filter((update) =>
            update.reason !== "decay"
            && update.reason !== "dormant"
          )
        : updates;

    const committed = await this.port.applyUpdates({
      userId: input.userId,
      subjectId: input.subjectId,
      updates: selectedUpdates,
    });

    return {
      scanned: candidates.length,
      threads: grouped.size,
      applied: committed.applied,
      conflicts: committed.conflicts,
      initialized: selectedUpdates.filter((update) => update.reason === "initialize").length,
      reinforced: selectedUpdates.filter((update) => update.reason === "reinforce").length,
      decayed: selectedUpdates.filter((update) => update.reason === "decay").length,
      dormantTransitions:
        selectedUpdates.filter((update) => update.reason === "dormant").length,
      reactivated:
        selectedUpdates.filter((update) => update.reason === "reactivate").length,
      active,
      dormant,
    };
  }

  private async reconcileSemanticGroups(
    userId: string,
    subjectId: string,
    exactGroups: Map<string, ThoughtEvolutionCandidate[]>,
  ): Promise<Map<string, ThoughtEvolutionCandidate[]>> {
    if (!this.semanticGrouping || exactGroups.size <= 1) {
      return exactGroups;
    }

    const semanticGroups: MindSemanticThreadGroup[] = [];
    for (const [threadKey, group] of exactGroups) {
      const anchor = group[0];
      if (!anchor) continue;
      semanticGroups.push({
        threadKey,
        anchorStateId: anchor.stateId,
        anchorText: anchor.text,
        createdAt: normalizeIso(anchor.createdAt, "createdAt"),
        newThread: !group.some((candidate) =>
          Boolean(safeReadThoughtEvolution(candidate.payload))
        ),
      });
    }

    let canonical: ReadonlyMap<string, string>;
    try {
      canonical = (
        await this.semanticGrouping.reconcile({
          userId,
          subjectId,
          kind: "thought",
          groups: semanticGroups,
        })
      ).canonicalThreadKeyByThread;
    } catch {
      // Semantic grouping is derived and fail-soft.
      return exactGroups;
    }

    const merged = new Map<string, ThoughtEvolutionCandidate[]>();
    for (const [threadKey, group] of exactGroups) {
      const target = canonical.get(threadKey) ?? threadKey;
      const current = merged.get(target) ?? [];
      current.push(...group);
      current.sort(
        (left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt)
          || left.stateId.localeCompare(right.stateId),
      );
      merged.set(target, current);
    }
    return merged;
  }
}

export function readThoughtEvolution(
  payload: Record<string, unknown> | null | undefined,
): ThoughtEvolutionState | null {
  if (!payload || !(THOUGHT_KEY in payload)) return null;
  const value = payload[THOUGHT_KEY];
  if (!isRecord(value)) {
    throw new Error("Thought evolution payload must be an object.");
  }

  const phase =
    value.phase === undefined ? "active" : value.phase;
  if (phase !== "active" && phase !== "dormant") {
    throw new Error("Thought phase is invalid.");
  }

  const role = value.role;
  if (role !== "anchor" && role !== "reinforcement") {
    throw new Error("Thought evolution role is invalid.");
  }

  const threadKey = requireString(value.threadKey, "threadKey");
  const anchorStateId = requireString(value.anchorStateId, "anchorStateId");
  const strength = requireUnitNumber(value.strength, "strength");
  const reinforcementCount = value.reinforcementCount;
  if (
    typeof reinforcementCount !== "number"
    || !Number.isInteger(reinforcementCount)
    || reinforcementCount < 1
  ) {
    throw new Error("Thought reinforcement count is invalid.");
  }

  if (
    !Array.isArray(value.reinforcementSources)
    || !value.reinforcementSources.every(
      (source) => typeof source === "string" && source.trim(),
    )
  ) {
    throw new Error("Thought reinforcement sources are invalid.");
  }

  const lastEvolvedAt = normalizeIso(value.lastEvolvedAt, "lastEvolvedAt");
  const lastReinforcedAt =
    normalizeIso(value.lastReinforcedAt, "lastReinforcedAt");
  const dormantAt =
    value.dormantAt === undefined || value.dormantAt === null
      ? null
      : normalizeIso(value.dormantAt, "dormantAt");
  if (phase === "dormant" && dormantAt === null) {
    throw new Error("Dormant Thought requires dormantAt.");
  }
  if (phase === "active" && dormantAt !== null) {
    throw new Error("Active Thought must not retain dormantAt.");
  }
  return {
    phase,
    role,
    threadKey,
    anchorStateId,
    strength,
    reinforcementCount,
    reinforcementSources: [...value.reinforcementSources],
    lastEvolvedAt,
    lastReinforcedAt,
    dormantAt,
  };
}

export function writeThoughtEvolution(
  payload: Record<string, unknown> | null | undefined,
  evolution: ThoughtEvolutionState,
): Record<string, unknown> {
  return {
    ...(payload ?? {}),
    [THOUGHT_KEY]: evolution,
  };
}

export function normalizeThoughtThreadText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

export function thoughtThreadKey(value: string): string {
  const normalized = normalizeThoughtThreadText(value);
  if (!normalized) {
    throw new Error("Thought thread text must not be blank.");
  }
  return createHash("sha256")
    .update("leileios:thought-thread:v1:" + normalized, "utf8")
    .digest("hex");
}

function groupCandidates(
  candidates: readonly ThoughtEvolutionCandidate[],
): Map<string, ThoughtEvolutionCandidate[]> {
  const groups = new Map<string, ThoughtEvolutionCandidate[]>();

  for (const candidate of candidates) {
    if (!candidate.text.trim()) continue;
    const current = safeReadThoughtEvolution(candidate.payload);
    const key = current?.threadKey ?? thoughtThreadKey(candidate.text);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt)
        || left.stateId.localeCompare(right.stateId),
    );
  }

  return groups;
}

function evaluateThread(
  candidates: readonly ThoughtEvolutionCandidate[],
  now: string,
  policy: ThoughtEvolutionPolicy,
  threadKey: string,
): {
  phase: ThoughtPhase;
  updates: ThoughtEvolutionUpdate[];
} {
  if (candidates.length === 0) {
    return { phase: "active", updates: [] };
  }

  const anchor = candidates[0]!;
  const uniqueSources = new Map<string, ThoughtEvolutionCandidate>();
  for (const candidate of candidates) {
    const existing = uniqueSources.get(candidate.sourceId);
    if (
      !existing
      || Date.parse(candidate.createdAt) > Date.parse(existing.createdAt)
    ) {
      uniqueSources.set(candidate.sourceId, candidate);
    }
  }

  const evidence = [...uniqueSources.values()].sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt)
      || left.stateId.localeCompare(right.stateId),
  );
  const latest = evidence[evidence.length - 1] ?? anchor;
  const reinforcementCount = evidence.length;
  const sources = evidence
    .map((candidate) => candidate.sourceId)
    .slice(-policy.maxReinforcementSources);

  const rawStrength = clamp01(
    policy.baseStrength
    + policy.reinforcementBoost * Math.max(0, reinforcementCount - 1),
  );
  const elapsedHours = Math.max(
    0,
    (Date.parse(now) - Date.parse(latest.createdAt)) / 3_600_000,
  );
  const decayedStrength = clamp01(
    rawStrength * Math.pow(0.5, elapsedHours / policy.halfLifeHours),
  );

  const strength = decayedStrength;
  const currentAnchor = safeReadThoughtEvolution(anchor.payload);
  const hasNewIndependentEvidence = Boolean(
    currentAnchor
    && (
      reinforcementCount > currentAnchor.reinforcementCount
      || sources.some(
        (source) => !currentAnchor.reinforcementSources.includes(source),
      )
    ),
  );
  const dormantThreshold = policy.dormantBelowStrength;
  const phase: ThoughtPhase =
    !currentAnchor
      ? dormantThreshold !== undefined && strength < dormantThreshold
        ? "dormant"
        : "active"
      : currentAnchor.phase === "dormant"
        ? hasNewIndependentEvidence
          && (dormantThreshold === undefined || strength >= dormantThreshold)
          ? "active"
          : "dormant"
        : dormantThreshold !== undefined && strength < dormantThreshold
          ? "dormant"
          : "active";
  const dormantAt =
    phase === "dormant"
      ? currentAnchor?.phase === "dormant"
        ? currentAnchor.dormantAt
        : now
      : null;

  const updates: ThoughtEvolutionUpdate[] = [];
  for (const candidate of candidates) {
    const current = safeReadThoughtEvolution(candidate.payload);
    const role: ThoughtEvolutionRole =
      candidate.stateId === anchor.stateId ? "anchor" : "reinforcement";
    const evolution: ThoughtEvolutionState = {
      phase,
      role,
      threadKey,
      anchorStateId: anchor.stateId,
      strength,
      reinforcementCount,
      reinforcementSources: sources,
      lastEvolvedAt: now,
      lastReinforcedAt: normalizeIso(latest.createdAt, "createdAt"),
      dormantAt,
    };

    const reason = evolutionReason(
      current,
      evolution,
      policy,
      now,
    );
    if (!reason) continue;

    updates.push({
      stateId: candidate.stateId,
      expectedUpdatedAt: candidate.updatedAt,
      expectedPayload: candidate.payload,
      nextPayload: writeThoughtEvolution(candidate.payload, evolution),
      evolution,
      reason,
    });
  }

  return { phase, updates };
}

function evolutionReason(
  current: ThoughtEvolutionState | null,
  next: ThoughtEvolutionState,
  policy: ThoughtEvolutionPolicy,
  now: string,
): ThoughtEvolutionUpdate["reason"] | null {
  if (!current) return "initialize";
  if (current.phase === "active" && next.phase === "dormant") {
    return "dormant";
  }
  if (current.phase === "dormant" && next.phase === "active") {
    return "reactivate";
  }
  if (
    current.reinforcementCount !== next.reinforcementCount
    || current.anchorStateId !== next.anchorStateId
    || current.role !== next.role
  ) {
    return "reinforce";
  }

  const elapsedHours =
    (Date.parse(now) - Date.parse(current.lastEvolvedAt)) / 3_600_000;
  if (elapsedHours < policy.minEvolutionIntervalHours) return null;
  if (
    Math.abs(current.strength - next.strength) < 1e-9
  ) {
    return null;
  }
  return "decay";
}

function safeReadThoughtEvolution(
  payload: Record<string, unknown> | null | undefined,
): ThoughtEvolutionState | null {
  try {
    return readThoughtEvolution(payload);
  } catch {
    return null;
  }
}

function validatePolicy(policy: ThoughtEvolutionPolicy): void {
  if (
    !Number.isFinite(policy.halfLifeHours)
    || policy.halfLifeHours <= 0
  ) {
    throw new Error("Thought half-life must be positive.");
  }
  for (const [label, value] of [
    ["baseStrength", policy.baseStrength],
    ["reinforcementBoost", policy.reinforcementBoost],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Thought ${label} must be between zero and one.`);
    }
  }
  if (
    policy.dormantBelowStrength !== undefined
    && (
      !Number.isFinite(policy.dormantBelowStrength)
      || policy.dormantBelowStrength <= 0
      || policy.dormantBelowStrength > 1
    )
  ) {
    throw new Error(
      "Thought dormant-below strength must be in (0, 1].",
    );
  }
  if (
    !Number.isFinite(policy.minEvolutionIntervalHours)
    || policy.minEvolutionIntervalHours < 0
  ) {
    throw new Error("Thought minimum evolution interval must be nonnegative.");
  }
  if (
    !Number.isInteger(policy.maxReinforcementSources)
    || policy.maxReinforcementSources < 1
  ) {
    throw new Error(
      "Thought reinforcement source limit must be a positive integer.",
    );
  }
}

function normalizeIso(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Thought ${label} is invalid.`);
  }
  return value;
}

function requireUnitNumber(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
    || value > 1
  ) {
    throw new Error(`Thought ${label} is invalid.`);
  }
  return value;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
