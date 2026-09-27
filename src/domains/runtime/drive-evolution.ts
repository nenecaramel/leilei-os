import { createHash } from "node:crypto";
import type {
  SubjectStateEvolutionRunMode,
} from "./subject-state-evolution-contract.js";
import type {
  MindSemanticGroupingService,
  MindSemanticThreadGroup,
} from "./mind-semantic-grouping.js";

export type DrivePhase = "active" | "satisfied" | "dormant";
export type DriveRole = "anchor" | "reinforcement";

export type DriveEvolutionState = {
  phase: DrivePhase;
  role: DriveRole;
  threadKey: string;
  anchorStateId: string;
  pressure: number;
  reinforcementCount: number;
  reinforcementSources: string[];
  satisfactionTotal: number;
  lastEvolvedAt: string;
  lastReinforcedAt: string;
  lastSatisfiedAt: string | null;
  dormantAt: string | null;
};

export type DriveEvolutionPolicy = {
  basePressure: number;
  reinforcementBoost: number;
  activeThreshold: number;
  dormantAfterSatisfiedHours?: number;
  minEvolutionIntervalHours: number;
  maxReinforcementSources: number;
};

export type DriveEvolutionCandidate = {
  stateId: string;
  text: string;
  payload: Record<string, unknown> | null;
  sourceId: string;
  createdAt: string;
  updatedAt: string;
  durableSatisfactionTotal?: number;
  durableLastSatisfiedAt?: string | null;
};

export type DriveEvolutionUpdate = {
  stateId: string;
  expectedUpdatedAt: string;
  expectedPayload: Record<string, unknown> | null;
  nextPayload: Record<string, unknown>;
  evolution: DriveEvolutionState;
  reason: "initialize" | "reinforce" | "recalculate";
};

export interface DriveEvolutionRuntimePort {
  listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<DriveEvolutionCandidate[]>;

  applyUpdates(input: {
    userId: string;
    subjectId: string;
    updates: readonly DriveEvolutionUpdate[];
  }): Promise<{ applied: number; conflicts: number }>;
}

export type DriveEvolutionRunResult = {
  scanned: number;
  threads: number;
  applied: number;
  conflicts: number;
  initialized: number;
  reinforced: number;
  recalculated: number;
  active: number;
  satisfied: number;
  dormant: number;
};

const DRIVE_KEY = "drive_v1";

export class DriveEvolutionService {
  constructor(
    private readonly port: DriveEvolutionRuntimePort,
    private readonly policy: DriveEvolutionPolicy,
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
  }): Promise<DriveEvolutionRunResult> {
    const now = normalizeIso(input.now, "now");
    const candidates = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: input.limit ?? 500,
    });
    const exactGroups = groupCandidates(candidates);
    const groups = await this.reconcileSemanticGroups(
      input.userId,
      input.subjectId,
      exactGroups,
    );
    const updates: DriveEvolutionUpdate[] = [];
    let active = 0;
    let satisfied = 0;
    let dormant = 0;

    for (const [threadKey, group] of groups) {
      const evaluated = evaluateThread(
        group,
        now,
        this.policy,
        threadKey,
      );
      updates.push(...evaluated.updates);
      if (evaluated.phase === "active") active += 1;
      else if (evaluated.phase === "satisfied") satisfied += 1;
      else dormant += 1;
    }

    const selectedUpdates =
      input.mode === "settlement_catch_up"
        ? updates.filter((update) =>
            update.reason === "initialize"
          || update.reason === "reinforce"
          )
        : updates;

    const committed = await this.port.applyUpdates({
      userId: input.userId,
      subjectId: input.subjectId,
      updates: selectedUpdates,
    });

    return {
      scanned: candidates.length,
      threads: groups.size,
      applied: committed.applied,
      conflicts: committed.conflicts,
      initialized: selectedUpdates.filter((update) => update.reason === "initialize").length,
      reinforced: selectedUpdates.filter((update) => update.reason === "reinforce").length,
      recalculated: selectedUpdates.filter((update) => update.reason === "recalculate").length,
      active,
      satisfied,
      dormant,
    };
  }

  private async reconcileSemanticGroups(
    userId: string,
    subjectId: string,
    exactGroups: Map<string, DriveEvolutionCandidate[]>,
  ): Promise<Map<string, DriveEvolutionCandidate[]>> {
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
          Boolean(safeReadDriveEvolution(candidate.payload))
        ),
      });
    }

    let canonical: ReadonlyMap<string, string>;
    try {
      canonical = (
        await this.semanticGrouping.reconcile({
          userId,
          subjectId,
          kind: "drive",
          groups: semanticGroups,
        })
      ).canonicalThreadKeyByThread;
    } catch {
      // Semantic grouping is derived and fail-soft. Exact grouping remains
      // authoritative enough to keep Drive evolution available.
      return exactGroups;
    }

    const merged = new Map<string, DriveEvolutionCandidate[]>();
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

export function readDriveEvolution(
  payload: Record<string, unknown> | null | undefined,
): DriveEvolutionState | null {
  if (!payload || !(DRIVE_KEY in payload)) return null;
  const value = payload[DRIVE_KEY];
  if (!isRecord(value)) {
    throw new Error("Drive evolution payload must be an object.");
  }

  const phase = value.phase;
  const role = value.role;
  if (
    phase !== "active"
    && phase !== "satisfied"
    && phase !== "dormant"
  ) {
    throw new Error("Drive phase is invalid.");
  }
  if (role !== "anchor" && role !== "reinforcement") {
    throw new Error("Drive role is invalid.");
  }

  const threadKey = requireString(value.threadKey, "threadKey");
  const anchorStateId = requireString(value.anchorStateId, "anchorStateId");
  const pressure = requireUnitNumber(value.pressure, "pressure");
  const satisfactionTotal = requireNonnegativeNumber(
    value.satisfactionTotal,
    "satisfactionTotal",
  );
  const reinforcementCount = value.reinforcementCount;
  if (
    typeof reinforcementCount !== "number"
    || !Number.isInteger(reinforcementCount)
    || reinforcementCount < 1
  ) {
    throw new Error("Drive reinforcement count is invalid.");
  }

  if (
    !Array.isArray(value.reinforcementSources)
    || !value.reinforcementSources.every(
      (source) => typeof source === "string" && source.trim(),
    )
  ) {
    throw new Error("Drive reinforcement sources are invalid.");
  }

  const dormantAt =
    value.dormantAt === undefined || value.dormantAt === null
      ? null
      : normalizeIso(value.dormantAt, "dormantAt");
  if (phase === "dormant" && dormantAt === null) {
    throw new Error("Dormant Drive requires dormantAt.");
  }
  if (phase !== "dormant" && dormantAt !== null) {
    throw new Error("Non-dormant Drive must not retain dormantAt.");
  }

  return {
    phase,
    role,
    threadKey,
    anchorStateId,
    pressure,
    reinforcementCount,
    reinforcementSources: [...value.reinforcementSources],
    satisfactionTotal,
    lastEvolvedAt: normalizeIso(value.lastEvolvedAt, "lastEvolvedAt"),
    lastReinforcedAt:
      normalizeIso(value.lastReinforcedAt, "lastReinforcedAt"),
    lastSatisfiedAt:
      value.lastSatisfiedAt === null
        ? null
        : normalizeIso(value.lastSatisfiedAt, "lastSatisfiedAt"),
    dormantAt,
  };
}

export function writeDriveEvolution(
  payload: Record<string, unknown> | null | undefined,
  evolution: DriveEvolutionState,
): Record<string, unknown> {
  return {
    ...(payload ?? {}),
    [DRIVE_KEY]: evolution,
  };
}

export function normalizeDriveThreadText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

export function driveThreadKey(value: string): string {
  const normalized = normalizeDriveThreadText(value);
  if (!normalized) throw new Error("Drive thread text must not be blank.");
  return createHash("sha256")
    .update("leileios:drive-thread:v1:" + normalized, "utf8")
    .digest("hex");
}

function groupCandidates(
  candidates: readonly DriveEvolutionCandidate[],
): Map<string, DriveEvolutionCandidate[]> {
  const groups = new Map<string, DriveEvolutionCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.text.trim()) continue;
    const current = safeReadDriveEvolution(candidate.payload);
    const key = current?.threadKey ?? driveThreadKey(candidate.text);
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
  candidates: readonly DriveEvolutionCandidate[],
  now: string,
  policy: DriveEvolutionPolicy,
  threadKey: string,
): {
  updates: DriveEvolutionUpdate[];
  phase: DrivePhase;
} {
  const anchor = candidates[0];
  if (!anchor) return { updates: [], phase: "satisfied" };

  const uniqueSources = new Map<string, DriveEvolutionCandidate>();
  for (const candidate of candidates) {
    const prior = uniqueSources.get(candidate.sourceId);
    if (
      !prior
      || Date.parse(candidate.createdAt) > Date.parse(prior.createdAt)
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
  const reinforcementSources = evidence
    .map((candidate) => candidate.sourceId)
    .slice(-policy.maxReinforcementSources);

  const priorStates = candidates
    .map((candidate) => safeReadDriveEvolution(candidate.payload))
    .filter((value): value is DriveEvolutionState => Boolean(value));
  const hasDurableSatisfactionProjection = candidates.some(
    (candidate) => candidate.durableSatisfactionTotal !== undefined,
  );
  const satisfactionTotal = hasDurableSatisfactionProjection
    ? canonicalizeDriveNumber(
        candidates.reduce(
          (sum, candidate) =>
            sum + (candidate.durableSatisfactionTotal ?? 0),
          0,
        ),
      )
    : Math.max(
        0,
        ...priorStates.map((state) => state.satisfactionTotal),
      );
  const lastSatisfiedAt = hasDurableSatisfactionProjection
    ? candidates
        .map((candidate) => candidate.durableLastSatisfiedAt ?? null)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null
    : priorStates
        .map((state) => state.lastSatisfiedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;

  const pressure = clampDrivePressure(
    policy.basePressure
    + policy.reinforcementBoost * Math.max(0, reinforcementCount - 1)
    - satisfactionTotal,
  );
  const priorDormantAt = priorStates
    .map((state) => state.dormantAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const activityAnchorAt = [lastSatisfiedAt, normalizeIso(latest.createdAt, "createdAt")]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const inactiveSatisfiedHours = activityAnchorAt
    ? Math.max(
        0,
        (Date.parse(now) - Date.parse(activityAnchorAt)) / 3_600_000,
      )
    : 0;
  const wasDormant = priorStates.some((state) => state.phase === "dormant");
  const phase: DrivePhase =
    pressure > policy.activeThreshold
      ? "active"
      : wasDormant
        ? "dormant"
        : policy.dormantAfterSatisfiedHours !== undefined
          && lastSatisfiedAt !== null
          && inactiveSatisfiedHours >= policy.dormantAfterSatisfiedHours
          ? "dormant"
          : "satisfied";
  const dormantAt =
    phase === "dormant"
      ? priorDormantAt ?? now
      : null;

  const updates: DriveEvolutionUpdate[] = [];
  for (const candidate of candidates) {
    const current = safeReadDriveEvolution(candidate.payload);
    const role: DriveRole =
      candidate.stateId === anchor.stateId ? "anchor" : "reinforcement";
    const evolution: DriveEvolutionState = {
      phase,
      role,
      threadKey,
      anchorStateId: anchor.stateId,
      pressure,
      reinforcementCount,
      reinforcementSources,
      satisfactionTotal,
      lastEvolvedAt: now,
      lastReinforcedAt: normalizeIso(latest.createdAt, "createdAt"),
      lastSatisfiedAt,
      dormantAt,
    };
    const reason = evolutionReason(current, evolution, policy, now);
    if (!reason) continue;
    updates.push({
      stateId: candidate.stateId,
      expectedUpdatedAt: candidate.updatedAt,
      expectedPayload: candidate.payload,
      nextPayload: writeDriveEvolution(candidate.payload, evolution),
      evolution,
      reason,
    });
  }

  return { updates, phase };
}

function evolutionReason(
  current: DriveEvolutionState | null,
  next: DriveEvolutionState,
  policy: DriveEvolutionPolicy,
  now: string,
): DriveEvolutionUpdate["reason"] | null {
  if (!current) return "initialize";
  if (
    current.reinforcementCount !== next.reinforcementCount
    || current.anchorStateId !== next.anchorStateId
    || current.role !== next.role
  ) {
    return "reinforce";
  }
  if (
    current.phase !== next.phase
    || Math.abs(current.pressure - next.pressure) > 1e-9
    || Math.abs(current.satisfactionTotal - next.satisfactionTotal) > 1e-9
    || current.lastSatisfiedAt !== next.lastSatisfiedAt
  ) {
    return "recalculate";
  }

  const elapsedHours =
    (Date.parse(now) - Date.parse(current.lastEvolvedAt)) / 3_600_000;
  return elapsedHours >= policy.minEvolutionIntervalHours
    ? "recalculate"
    : null;
}

function safeReadDriveEvolution(
  payload: Record<string, unknown> | null | undefined,
): DriveEvolutionState | null {
  try {
    return readDriveEvolution(payload);
  } catch {
    return null;
  }
}

function validatePolicy(policy: DriveEvolutionPolicy): void {
  requirePolicyUnit(policy.basePressure, "base pressure");
  requirePolicyUnit(policy.reinforcementBoost, "reinforcement boost");
  requirePolicyUnit(policy.activeThreshold, "active threshold");
  if (
    policy.dormantAfterSatisfiedHours !== undefined
    && (
      !Number.isFinite(policy.dormantAfterSatisfiedHours)
      || policy.dormantAfterSatisfiedHours <= 0
    )
  ) {
    throw new Error(
      "Drive dormant-after-satisfied hours must be positive when configured.",
    );
  }
  if (
    !Number.isFinite(policy.minEvolutionIntervalHours)
    || policy.minEvolutionIntervalHours < 0
  ) {
    throw new Error("Drive minimum evolution interval must be nonnegative.");
  }
  if (
    !Number.isInteger(policy.maxReinforcementSources)
    || policy.maxReinforcementSources < 1
  ) {
    throw new Error(
      "Drive reinforcement source limit must be a positive integer.",
    );
  }
}

function requirePolicyUnit(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Drive ${label} must be between zero and one.`);
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
    throw new Error(`Drive ${label} is invalid.`);
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
    throw new Error(`Drive ${label} is invalid.`);
  }
  return value;
}

function requireNonnegativeNumber(value: unknown, label: string): number {
  if (
    typeof value !== "number"
    || !Number.isFinite(value)
    || value < 0
  ) {
    throw new Error(`Drive ${label} is invalid.`);
  }
  return value;
}

export function canonicalizeDriveNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Drive numeric state must be finite.");
  }
  return Number(value.toFixed(12));
}

export function clampDrivePressure(value: number): number {
  return canonicalizeDriveNumber(Math.min(1, Math.max(0, value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
