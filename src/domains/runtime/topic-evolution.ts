import { createHash } from "node:crypto";
import type {
  SubjectStateEvolutionRunMode,
} from "./subject-state-evolution-contract.js";
import type {
  MindSemanticGroupingService,
  MindSemanticThreadGroup,
} from "./mind-semantic-grouping.js";

export type TopicPhase = "active" | "dormant";
export type TopicRole = "anchor" | "reinforcement";

export type TopicEvolutionState = {
  phase: TopicPhase;
  role: TopicRole;
  threadKey: string;
  anchorStateId: string;
  reinforcementCount: number;
  reinforcementSources: string[];
  lastEvolvedAt: string;
  lastReinforcedAt: string;
  dormantAt: string | null;
};

export type TopicEvolutionPolicy = {
  maxReinforcementSources: number;
  dormantAfterHours: number;
};

export type TopicEvolutionCandidate = {
  stateId: string;
  text: string;
  payload: Record<string, unknown> | null;
  sourceId: string;
  createdAt: string;
  updatedAt: string;
};

export type TopicEvolutionUpdate = {
  stateId: string;
  expectedUpdatedAt: string;
  expectedPayload: Record<string, unknown> | null;
  nextPayload: Record<string, unknown>;
  evolution: TopicEvolutionState;
  reason: "initialize" | "reinforce" | "dormant" | "reactivate";
};

export interface TopicEvolutionRuntimePort {
  listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<TopicEvolutionCandidate[]>;

  applyUpdates(input: {
    userId: string;
    subjectId: string;
    updates: readonly TopicEvolutionUpdate[];
  }): Promise<{ applied: number; conflicts: number }>;
}

export type TopicEvolutionRunResult = {
  scanned: number;
  threads: number;
  applied: number;
  conflicts: number;
  initialized: number;
  reinforced: number;
  dormantTransitions: number;
  reactivated: number;
  active: number;
  dormant: number;
};

const TOPIC_KEY = "topic_v1";

export class TopicEvolutionService {
  constructor(
    private readonly port: TopicEvolutionRuntimePort,
    private readonly policy: TopicEvolutionPolicy,
    private readonly semanticGrouping:
      Pick<MindSemanticGroupingService, "reconcile"> | null = null,
  ) {
    if (
      !Number.isInteger(policy.maxReinforcementSources)
      || policy.maxReinforcementSources < 1
    ) {
      throw new Error(
        "Topic reinforcement source limit must be a positive integer.",
      );
    }
    if (
      !Number.isFinite(policy.dormantAfterHours)
      || policy.dormantAfterHours <= 0
    ) {
      throw new Error(
        "Topic dormantAfterHours must be a positive finite number.",
      );
    }
  }

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
    mode?: SubjectStateEvolutionRunMode;
  }): Promise<TopicEvolutionRunResult> {
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
    const updates: TopicEvolutionUpdate[] = [];
    let active = 0;
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
      else dormant += 1;
    }

    const selectedUpdates =
      input.mode === "settlement_catch_up"
        ? updates.filter((update) =>
            update.reason !== "dormant"
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
    exactGroups: Map<string, TopicEvolutionCandidate[]>,
  ): Promise<Map<string, TopicEvolutionCandidate[]>> {
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
          Boolean(safeReadTopicEvolution(candidate.payload))
        ),
      });
    }

    let canonical: ReadonlyMap<string, string>;
    try {
      canonical = (
        await this.semanticGrouping.reconcile({
          userId,
          subjectId,
          kind: "topic",
          groups: semanticGroups,
        })
      ).canonicalThreadKeyByThread;
    } catch {
      return exactGroups;
    }

    const merged = new Map<string, TopicEvolutionCandidate[]>();
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

export function readTopicEvolution(
  payload: Record<string, unknown> | null | undefined,
): TopicEvolutionState | null {
  if (!payload || !(TOPIC_KEY in payload)) return null;
  const value = payload[TOPIC_KEY];
  if (!isRecord(value)) {
    throw new Error("Topic evolution payload must be an object.");
  }

  if (value.phase !== "active" && value.phase !== "dormant") {
    throw new Error("Topic phase is invalid.");
  }
  if (value.role !== "anchor" && value.role !== "reinforcement") {
    throw new Error("Topic role is invalid.");
  }

  const reinforcementCount = value.reinforcementCount;
  if (
    typeof reinforcementCount !== "number"
    || !Number.isInteger(reinforcementCount)
    || reinforcementCount < 1
  ) {
    throw new Error("Topic reinforcement count is invalid.");
  }
  if (
    !Array.isArray(value.reinforcementSources)
    || !value.reinforcementSources.every(
      (source) => typeof source === "string" && source.trim(),
    )
  ) {
    throw new Error("Topic reinforcement sources are invalid.");
  }

  const dormantAt =
    value.dormantAt === null
      ? null
      : normalizeIso(value.dormantAt, "dormantAt");
  if (value.phase === "dormant" && dormantAt === null) {
    throw new Error("Dormant Topic requires dormantAt.");
  }
  if (value.phase === "active" && dormantAt !== null) {
    throw new Error("Active Topic must not retain dormantAt.");
  }

  return {
    phase: value.phase,
    role: value.role,
    threadKey: requireString(value.threadKey, "threadKey"),
    anchorStateId: requireString(value.anchorStateId, "anchorStateId"),
    reinforcementCount,
    reinforcementSources: [...value.reinforcementSources],
    lastEvolvedAt: normalizeIso(value.lastEvolvedAt, "lastEvolvedAt"),
    lastReinforcedAt:
      normalizeIso(value.lastReinforcedAt, "lastReinforcedAt"),
    dormantAt,
  };
}

export function writeTopicEvolution(
  payload: Record<string, unknown> | null | undefined,
  evolution: TopicEvolutionState,
): Record<string, unknown> {
  return {
    ...(payload ?? {}),
    [TOPIC_KEY]: evolution,
  };
}

export function normalizeTopicThreadText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

export function topicThreadKey(value: string): string {
  const normalized = normalizeTopicThreadText(value);
  if (!normalized) throw new Error("Topic thread text must not be blank.");
  return createHash("sha256")
    .update("leileios:topic-thread:v1:" + normalized, "utf8")
    .digest("hex");
}

function groupCandidates(
  candidates: readonly TopicEvolutionCandidate[],
): Map<string, TopicEvolutionCandidate[]> {
  const groups = new Map<string, TopicEvolutionCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.text.trim()) continue;
    const current = safeReadTopicEvolution(candidate.payload);
    const key = current?.threadKey ?? topicThreadKey(candidate.text);
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
  candidates: readonly TopicEvolutionCandidate[],
  now: string,
  policy: TopicEvolutionPolicy,
  threadKey: string,
): {
  phase: TopicPhase;
  updates: TopicEvolutionUpdate[];
} {
  const anchor = candidates[0];
  if (!anchor) return { phase: "active", updates: [] };

  const uniqueSources = new Map<string, TopicEvolutionCandidate>();
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
  const latestReinforcedAt = normalizeIso(latest.createdAt, "createdAt");
  const currentAnchor = safeReadTopicEvolution(anchor.payload);
  const hasNewIndependentEvidence = Boolean(
    currentAnchor
    && (
      reinforcementCount > currentAnchor.reinforcementCount
      || reinforcementSources.some(
        (source) => !currentAnchor.reinforcementSources.includes(source),
      )
    ),
  );
  const activityAnchorAt = currentAnchor
    ? Math.max(
        Date.parse(currentAnchor.lastReinforcedAt),
        Date.parse(currentAnchor.lastEvolvedAt),
      )
    : Date.parse(now);
  const inactiveHours = Math.max(
    0,
    (Date.parse(now) - activityAnchorAt) / 3_600_000,
  );
  const phase: TopicPhase =
    !currentAnchor || hasNewIndependentEvidence
      ? "active"
      : currentAnchor.phase === "dormant"
        ? "dormant"
        : inactiveHours >= policy.dormantAfterHours
          ? "dormant"
          : "active";
  const dormantAt =
    phase === "dormant"
      ? currentAnchor?.phase === "dormant"
        ? currentAnchor.dormantAt
        : now
      : null;
  const updates: TopicEvolutionUpdate[] = [];

  for (const candidate of candidates) {
    const current = safeReadTopicEvolution(candidate.payload);
    const role: TopicRole =
      candidate.stateId === anchor.stateId ? "anchor" : "reinforcement";
    const evolution: TopicEvolutionState = {
      phase,
      role,
      threadKey,
      anchorStateId: anchor.stateId,
      reinforcementCount,
      reinforcementSources,
      lastEvolvedAt: now,
      lastReinforcedAt: latestReinforcedAt,
      dormantAt,
    };
    const reason = evolutionReason(current, evolution);
    if (!reason) continue;

    updates.push({
      stateId: candidate.stateId,
      expectedUpdatedAt: candidate.updatedAt,
      expectedPayload: candidate.payload,
      nextPayload: writeTopicEvolution(candidate.payload, evolution),
      evolution,
      reason,
    });
  }

  return { phase, updates };
}

function evolutionReason(
  current: TopicEvolutionState | null,
  next: TopicEvolutionState,
): TopicEvolutionUpdate["reason"] | null {
  if (!current) return "initialize";
  if (current.phase === "active" && next.phase === "dormant") {
    return "dormant";
  }
  if (current.phase === "dormant" && next.phase === "active") {
    return "reactivate";
  }
  if (
    current.anchorStateId !== next.anchorStateId
    || current.role !== next.role
    || current.threadKey !== next.threadKey
    || current.reinforcementCount !== next.reinforcementCount
    || current.phase !== next.phase
    || current.lastReinforcedAt !== next.lastReinforcedAt
    || current.dormantAt !== next.dormantAt
    || !sameStrings(current.reinforcementSources, next.reinforcementSources)
  ) {
    return "reinforce";
  }
  return null;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function safeReadTopicEvolution(
  payload: Record<string, unknown> | null | undefined,
): TopicEvolutionState | null {
  try {
    return readTopicEvolution(payload);
  } catch {
    return null;
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
    throw new Error(`Topic ${label} is invalid.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
