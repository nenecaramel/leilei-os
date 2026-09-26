import { createHash } from "node:crypto";
import type {
  SubjectStateEvolutionRunMode,
} from "./subject-state-evolution-contract.js";

export type CuriosityPhase = "active" | "resolved" | "dormant";
export type CuriosityEvolutionRole = "anchor" | "reinforcement";

export type CuriosityEvolutionState = {
  phase: CuriosityPhase;
  role: CuriosityEvolutionRole;
  threadKey: string;
  anchorStateId: string;
  reinforcementCount: number;
  reinforcementSources: string[];
  lastEvolvedAt: string;
  lastReinforcedAt: string;
  resolvedAt: string | null;
  resolutionSourceId: string | null;
  dormantAt: string | null;
};

export type CuriosityEvolutionPolicy = {
  maxReinforcementSources: number;
  dormantAfterHours: number;
};

export type CuriosityEvolutionCandidate = {
  stateId: string;
  text: string;
  payload: Record<string, unknown> | null;
  sourceId: string;
  createdAt: string;
  updatedAt: string;
};

export type CuriosityEvolutionUpdate = {
  stateId: string;
  expectedUpdatedAt: string;
  expectedPayload: Record<string, unknown> | null;
  nextPayload: Record<string, unknown>;
  evolution: CuriosityEvolutionState;
  reason: "initialize" | "reinforce" | "dormant" | "reactivate";
};

export interface CuriosityEvolutionRuntimePort {
  listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<CuriosityEvolutionCandidate[]>;

  applyUpdates(input: {
    userId: string;
    subjectId: string;
    updates: readonly CuriosityEvolutionUpdate[];
  }): Promise<{ applied: number; conflicts: number }>;
}

export type CuriosityEvolutionRunResult = {
  scanned: number;
  threads: number;
  applied: number;
  conflicts: number;
  initialized: number;
  reinforced: number;
  dormantTransitions: number;
  reactivated: number;
  active: number;
  resolved: number;
  dormant: number;
};

const CURIOSITY_KEY = "curiosity_v1";

export class CuriosityEvolutionService {
  constructor(
    private readonly port: CuriosityEvolutionRuntimePort,
    private readonly policy: CuriosityEvolutionPolicy,
  ) {
    validatePolicy(policy);
  }

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
    mode?: SubjectStateEvolutionRunMode;
  }): Promise<CuriosityEvolutionRunResult> {
    const now = normalizeIso(input.now, "now");
    const candidates = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: input.limit ?? 500,
    });
    const groups = groupCandidates(candidates);
    const updates: CuriosityEvolutionUpdate[] = [];
    let active = 0;
    let resolved = 0;
    let dormant = 0;

    for (const group of groups.values()) {
      const evaluated = evaluateThread(group, now, this.policy);
      updates.push(...evaluated.updates);
      if (evaluated.phase === "active") active += 1;
      else if (evaluated.phase === "resolved") resolved += 1;
      else dormant += 1;
    }

    const selectedUpdates =
      input.mode === "settlement_catch_up"
        ? updates.filter((update) => update.reason !== "dormant")
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
      initialized:
        selectedUpdates.filter((update) => update.reason === "initialize").length,
      reinforced:
        selectedUpdates.filter((update) => update.reason === "reinforce").length,
      dormantTransitions:
        selectedUpdates.filter((update) => update.reason === "dormant").length,
      reactivated:
        selectedUpdates.filter((update) => update.reason === "reactivate").length,
      active,
      resolved,
      dormant,
    };
  }
}

export function readCuriosityEvolution(
  payload: Record<string, unknown> | null | undefined,
): CuriosityEvolutionState | null {
  if (!payload || !(CURIOSITY_KEY in payload)) return null;
  const value = payload[CURIOSITY_KEY];
  if (!isRecord(value)) {
    throw new Error("Curiosity evolution payload must be an object.");
  }

  const phase = value.phase;
  if (phase !== "active" && phase !== "resolved" && phase !== "dormant") {
    throw new Error("Curiosity phase is invalid.");
  }
  const role = value.role;
  if (role !== "anchor" && role !== "reinforcement") {
    throw new Error("Curiosity evolution role is invalid.");
  }

  const reinforcementCount = value.reinforcementCount;
  if (
    typeof reinforcementCount !== "number"
    || !Number.isInteger(reinforcementCount)
    || reinforcementCount < 1
  ) {
    throw new Error("Curiosity reinforcement count is invalid.");
  }
  if (
    !Array.isArray(value.reinforcementSources)
    || !value.reinforcementSources.every(
      (source) => typeof source === "string" && source.trim(),
    )
  ) {
    throw new Error("Curiosity reinforcement sources are invalid.");
  }

  const resolvedAt =
    value.resolvedAt === null
      ? null
      : normalizeIso(value.resolvedAt, "resolvedAt");
  const resolutionSourceId =
    value.resolutionSourceId === null
      ? null
      : requireString(value.resolutionSourceId, "resolutionSourceId");
  const dormantAt =
    value.dormantAt === null
      ? null
      : normalizeIso(value.dormantAt, "dormantAt");

  if (phase === "active") {
    if (resolvedAt !== null || resolutionSourceId !== null || dormantAt !== null) {
      throw new Error("Active Curiosity must not retain terminal timestamps.");
    }
  }
  if (phase === "resolved") {
    if (resolvedAt === null || resolutionSourceId === null || dormantAt !== null) {
      throw new Error("Resolved Curiosity requires resolution provenance.");
    }
  }
  if (phase === "dormant") {
    if (dormantAt === null) {
      throw new Error("Dormant Curiosity requires dormantAt.");
    }
    if ((resolvedAt === null) !== (resolutionSourceId === null)) {
      throw new Error("Dormant Curiosity resolution provenance is incomplete.");
    }
  }

  return {
    phase,
    role,
    threadKey: requireString(value.threadKey, "threadKey"),
    anchorStateId: requireString(value.anchorStateId, "anchorStateId"),
    reinforcementCount,
    reinforcementSources: [...value.reinforcementSources],
    lastEvolvedAt: normalizeIso(value.lastEvolvedAt, "lastEvolvedAt"),
    lastReinforcedAt:
      normalizeIso(value.lastReinforcedAt, "lastReinforcedAt"),
    resolvedAt,
    resolutionSourceId,
    dormantAt,
  };
}

export function writeCuriosityEvolution(
  payload: Record<string, unknown> | null | undefined,
  evolution: CuriosityEvolutionState,
): Record<string, unknown> {
  return {
    ...(payload ?? {}),
    [CURIOSITY_KEY]: evolution,
  };
}

export function resolveCuriosityEvolution(
  current: CuriosityEvolutionState,
  input: {
    now: string;
    resolutionSourceId: string;
  },
): CuriosityEvolutionState {
  if (current.phase === "resolved") return current;
  if (current.phase !== "active") {
    throw new Error("Only active Curiosity can be resolved.");
  }
  const now = normalizeIso(input.now, "now");
  const resolutionSourceId =
    requireString(input.resolutionSourceId, "resolutionSourceId");
  return {
    ...current,
    phase: "resolved",
    lastEvolvedAt: now,
    resolvedAt: now,
    resolutionSourceId,
    dormantAt: null,
  };
}

export function normalizeCuriosityThreadText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

export function curiosityThreadKey(value: string): string {
  const normalized = normalizeCuriosityThreadText(value);
  if (!normalized) {
    throw new Error("Curiosity thread text must not be blank.");
  }
  return createHash("sha256")
    .update("leileios:curiosity-thread:v1:" + normalized, "utf8")
    .digest("hex");
}

function groupCandidates(
  candidates: readonly CuriosityEvolutionCandidate[],
): Map<string, CuriosityEvolutionCandidate[]> {
  const groups = new Map<string, CuriosityEvolutionCandidate[]>();

  for (const candidate of candidates) {
    if (!candidate.text.trim()) continue;
    const key = curiosityThreadKey(candidate.text);
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
  candidates: readonly CuriosityEvolutionCandidate[],
  now: string,
  policy: CuriosityEvolutionPolicy,
): {
  phase: CuriosityPhase;
  updates: CuriosityEvolutionUpdate[];
} {
  const anchor = candidates[0];
  if (!anchor) return { phase: "active", updates: [] };

  const uniqueSources = new Map<string, CuriosityEvolutionCandidate>();
  for (const candidate of candidates) {
    if (!uniqueSources.has(candidate.sourceId)) {
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
  const currentAnchor = safeReadCuriosityEvolution(anchor.payload);
  const hasNewIndependentEvidence = Boolean(
    currentAnchor
    && (
      reinforcementCount > currentAnchor.reinforcementCount
      || reinforcementSources.some(
        (source) => !currentAnchor.reinforcementSources.includes(source),
      )
    ),
  );

  const nowMs = Date.parse(now);
  const inactivityHours = Math.max(
    0,
    (nowMs - Date.parse(latest.createdAt)) / 3_600_000,
  );
  const resolvedHours =
    currentAnchor?.resolvedAt
      ? Math.max(
          0,
          (nowMs - Date.parse(currentAnchor.resolvedAt)) / 3_600_000,
        )
      : 0;

  const phase: CuriosityPhase =
    !currentAnchor
      ? "active"
      : hasNewIndependentEvidence
        && (
          currentAnchor.phase === "dormant"
          || currentAnchor.phase === "resolved"
        )
        ? "active"
        : currentAnchor.phase === "resolved"
          ? resolvedHours >= policy.dormantAfterHours
            ? "dormant"
            : "resolved"
          : currentAnchor.phase === "dormant"
            ? "dormant"
            : inactivityHours >= policy.dormantAfterHours
              ? "dormant"
              : "active";

  const resolvedAt =
    phase === "resolved"
      ? currentAnchor?.resolvedAt ?? null
      : phase === "dormant" && currentAnchor?.phase === "resolved"
        ? currentAnchor.resolvedAt
        : phase === "dormant" && currentAnchor?.phase === "dormant"
          ? currentAnchor.resolvedAt
          : null;
  const resolutionSourceId =
    phase === "resolved"
      ? currentAnchor?.resolutionSourceId ?? null
      : phase === "dormant" && currentAnchor?.phase === "resolved"
        ? currentAnchor.resolutionSourceId
        : phase === "dormant" && currentAnchor?.phase === "dormant"
          ? currentAnchor.resolutionSourceId
          : null;
  const dormantAt =
    phase === "dormant"
      ? currentAnchor?.phase === "dormant"
        ? currentAnchor.dormantAt
        : now
      : null;

  const updates: CuriosityEvolutionUpdate[] = [];
  for (const candidate of candidates) {
    const current = safeReadCuriosityEvolution(candidate.payload);
    const role: CuriosityEvolutionRole =
      candidate.stateId === anchor.stateId ? "anchor" : "reinforcement";
    const evolution: CuriosityEvolutionState = {
      phase,
      role,
      threadKey: curiosityThreadKey(anchor.text),
      anchorStateId: anchor.stateId,
      reinforcementCount,
      reinforcementSources,
      lastEvolvedAt: now,
      lastReinforcedAt: normalizeIso(latest.createdAt, "createdAt"),
      resolvedAt,
      resolutionSourceId,
      dormantAt,
    };
    const reason = evolutionReason(current, evolution);
    if (!reason) continue;

    updates.push({
      stateId: candidate.stateId,
      expectedUpdatedAt: candidate.updatedAt,
      expectedPayload: candidate.payload,
      nextPayload: writeCuriosityEvolution(candidate.payload, evolution),
      evolution,
      reason,
    });
  }

  return { phase, updates };
}

function evolutionReason(
  current: CuriosityEvolutionState | null,
  next: CuriosityEvolutionState,
): CuriosityEvolutionUpdate["reason"] | null {
  if (!current) return "initialize";
  if (current.phase !== "dormant" && next.phase === "dormant") {
    return "dormant";
  }
  if (
    (current.phase === "dormant" || current.phase === "resolved")
    && next.phase === "active"
  ) {
    return "reactivate";
  }
  if (
    current.anchorStateId !== next.anchorStateId
    || current.role !== next.role
    || current.threadKey !== next.threadKey
    || current.reinforcementCount !== next.reinforcementCount
    || current.lastReinforcedAt !== next.lastReinforcedAt
    || !sameStrings(current.reinforcementSources, next.reinforcementSources)
  ) {
    return "reinforce";
  }
  return null;
}

function safeReadCuriosityEvolution(
  payload: Record<string, unknown> | null | undefined,
): CuriosityEvolutionState | null {
  try {
    return readCuriosityEvolution(payload);
  } catch {
    return null;
  }
}

function validatePolicy(policy: CuriosityEvolutionPolicy): void {
  if (
    !Number.isInteger(policy.maxReinforcementSources)
    || policy.maxReinforcementSources < 1
  ) {
    throw new Error(
      "Curiosity reinforcement source limit must be a positive integer.",
    );
  }
  if (
    !Number.isFinite(policy.dormantAfterHours)
    || policy.dormantAfterHours <= 0
  ) {
    throw new Error(
      "Curiosity dormantAfterHours must be a positive finite number.",
    );
  }
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
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
    throw new Error(`Curiosity ${label} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
