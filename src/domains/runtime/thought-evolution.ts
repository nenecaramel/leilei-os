import { createHash } from "node:crypto";

export type ThoughtEvolutionStage = "flit" | "fixation";
export type ThoughtEvolutionRole = "anchor" | "reinforcement";

export type ThoughtEvolutionState = {
  stage: ThoughtEvolutionStage;
  role: ThoughtEvolutionRole;
  threadKey: string;
  anchorStateId: string;
  strength: number;
  reinforcementCount: number;
  reinforcementSources: string[];
  lastEvolvedAt: string;
  lastReinforcedAt: string;
  fixationAt: string | null;
};

export type ThoughtEvolutionPolicy = {
  flitHalfLifeHours: number;
  baseStrength: number;
  reinforcementBoost: number;
  fixationThreshold: number;
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
  reason: "initialize" | "decay" | "reinforce" | "promote";
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
  promoted: number;
  decayed: number;
  fixations: number;
};

const THOUGHT_KEY = "thought_v1";

export class ThoughtEvolutionService {
  constructor(
    private readonly port: ThoughtEvolutionRuntimePort,
    private readonly policy: ThoughtEvolutionPolicy,
  ) {
    validatePolicy(policy);
  }

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
  }): Promise<ThoughtEvolutionRunResult> {
    const now = normalizeIso(input.now, "now");
    const candidates = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: input.limit ?? 500,
    });

    const grouped = groupCandidates(candidates);
    const updates: ThoughtEvolutionUpdate[] = [];
    let fixations = 0;

    for (const group of grouped.values()) {
      const evaluated = evaluateThread(group, now, this.policy);
      updates.push(...evaluated.updates);
      if (evaluated.stage === "fixation") fixations += 1;
    }

    const committed = await this.port.applyUpdates({
      userId: input.userId,
      subjectId: input.subjectId,
      updates,
    });

    return {
      scanned: candidates.length,
      threads: grouped.size,
      applied: committed.applied,
      conflicts: committed.conflicts,
      initialized: updates.filter((update) => update.reason === "initialize").length,
      reinforced: updates.filter((update) => update.reason === "reinforce").length,
      promoted: updates.filter((update) => update.reason === "promote").length,
      decayed: updates.filter((update) => update.reason === "decay").length,
      fixations,
    };
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

  const stage = value.stage;
  const role = value.role;
  if (stage !== "flit" && stage !== "fixation") {
    throw new Error("Thought evolution stage is invalid.");
  }
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
  const fixationAt =
    value.fixationAt === null
      ? null
      : normalizeIso(value.fixationAt, "fixationAt");

  if (
    (stage === "fixation" && fixationAt === null)
    || (stage === "flit" && fixationAt !== null)
  ) {
    throw new Error("Thought fixation timestamp does not match stage.");
  }

  return {
    stage,
    role,
    threadKey,
    anchorStateId,
    strength,
    reinforcementCount,
    reinforcementSources: [...value.reinforcementSources],
    lastEvolvedAt,
    lastReinforcedAt,
    fixationAt,
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
    const key = thoughtThreadKey(candidate.text);
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
): {
  updates: ThoughtEvolutionUpdate[];
  stage: ThoughtEvolutionStage;
} {
  if (candidates.length === 0) {
    return { updates: [], stage: "flit" };
  }

  const anchor = candidates[0]!;
  const key = thoughtThreadKey(anchor.text);
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
    rawStrength * Math.pow(0.5, elapsedHours / policy.flitHalfLifeHours),
  );

  const priorAnchor = safeReadThoughtEvolution(anchor.payload);
  const stage: ThoughtEvolutionStage =
    priorAnchor?.stage === "fixation"
    || decayedStrength >= policy.fixationThreshold
      ? "fixation"
      : "flit";
  const strength =
    priorAnchor?.stage === "fixation"
      ? Math.max(priorAnchor.strength, rawStrength)
      : decayedStrength;
  const fixationAt =
    stage === "fixation"
      ? priorAnchor?.fixationAt ?? now
      : null;

  const updates: ThoughtEvolutionUpdate[] = [];
  for (const candidate of candidates) {
    const current = safeReadThoughtEvolution(candidate.payload);
    const role: ThoughtEvolutionRole =
      candidate.stateId === anchor.stateId ? "anchor" : "reinforcement";
    const evolution: ThoughtEvolutionState = {
      stage,
      role,
      threadKey: key,
      anchorStateId: anchor.stateId,
      strength,
      reinforcementCount,
      reinforcementSources: sources,
      lastEvolvedAt: now,
      lastReinforcedAt: normalizeIso(latest.createdAt, "createdAt"),
      fixationAt,
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

  return { updates, stage };
}

function evolutionReason(
  current: ThoughtEvolutionState | null,
  next: ThoughtEvolutionState,
  policy: ThoughtEvolutionPolicy,
  now: string,
): ThoughtEvolutionUpdate["reason"] | null {
  if (!current) return "initialize";
  if (current.stage !== "fixation" && next.stage === "fixation") {
    return "promote";
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
    current.stage === next.stage
    && Math.abs(current.strength - next.strength) < 1e-9
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
    !Number.isFinite(policy.flitHalfLifeHours)
    || policy.flitHalfLifeHours <= 0
  ) {
    throw new Error("Thought flit half-life must be positive.");
  }
  for (const [label, value] of [
    ["baseStrength", policy.baseStrength],
    ["reinforcementBoost", policy.reinforcementBoost],
    ["fixationThreshold", policy.fixationThreshold],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Thought ${label} must be between zero and one.`);
    }
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
