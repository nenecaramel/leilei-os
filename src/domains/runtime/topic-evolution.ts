import { createHash } from "node:crypto";

export type TopicPhase = "active";
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
};

export type TopicEvolutionPolicy = {
  maxReinforcementSources: number;
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
  reason: "initialize" | "reinforce";
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
  active: number;
};

const TOPIC_KEY = "topic_v1";

export class TopicEvolutionService {
  constructor(
    private readonly port: TopicEvolutionRuntimePort,
    private readonly policy: TopicEvolutionPolicy,
  ) {
    if (
      !Number.isInteger(policy.maxReinforcementSources)
      || policy.maxReinforcementSources < 1
    ) {
      throw new Error(
        "Topic reinforcement source limit must be a positive integer.",
      );
    }
  }

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
  }): Promise<TopicEvolutionRunResult> {
    const now = normalizeIso(input.now, "now");
    const candidates = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: input.limit ?? 500,
    });
    const groups = groupCandidates(candidates);
    const updates: TopicEvolutionUpdate[] = [];

    for (const group of groups.values()) {
      updates.push(...evaluateThread(group, now, this.policy));
    }

    const committed = await this.port.applyUpdates({
      userId: input.userId,
      subjectId: input.subjectId,
      updates,
    });

    return {
      scanned: candidates.length,
      threads: groups.size,
      applied: committed.applied,
      conflicts: committed.conflicts,
      initialized: updates.filter((update) => update.reason === "initialize").length,
      reinforced: updates.filter((update) => update.reason === "reinforce").length,
      active: groups.size,
    };
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

  if (value.phase !== "active") {
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

  return {
    phase: "active",
    role: value.role,
    threadKey: requireString(value.threadKey, "threadKey"),
    anchorStateId: requireString(value.anchorStateId, "anchorStateId"),
    reinforcementCount,
    reinforcementSources: [...value.reinforcementSources],
    lastEvolvedAt: normalizeIso(value.lastEvolvedAt, "lastEvolvedAt"),
    lastReinforcedAt:
      normalizeIso(value.lastReinforcedAt, "lastReinforcedAt"),
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
    const key = topicThreadKey(candidate.text);
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
): TopicEvolutionUpdate[] {
  const anchor = candidates[0];
  if (!anchor) return [];

  const uniqueSources = new Map<string, TopicEvolutionCandidate>();
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
  const updates: TopicEvolutionUpdate[] = [];

  for (const candidate of candidates) {
    const current = safeReadTopicEvolution(candidate.payload);
    const role: TopicRole =
      candidate.stateId === anchor.stateId ? "anchor" : "reinforcement";
    const evolution: TopicEvolutionState = {
      phase: "active",
      role,
      threadKey: topicThreadKey(anchor.text),
      anchorStateId: anchor.stateId,
      reinforcementCount,
      reinforcementSources,
      lastEvolvedAt: now,
      lastReinforcedAt: normalizeIso(latest.createdAt, "createdAt"),
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

  return updates;
}

function evolutionReason(
  current: TopicEvolutionState | null,
  next: TopicEvolutionState,
): TopicEvolutionUpdate["reason"] | null {
  if (!current) return "initialize";
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
