export type SubjectStateLifecycleStatus =
  | "active"
  | "fading"
  | "archived"
  | "forgotten";

export type SubjectStateLifecycle = {
  status: SubjectStateLifecycleStatus;
  salience: number;
  protected: boolean;
  lastDecayedAt: string;
  lastRecalledAt: string | null;
  archivedAt: string | null;
  forgottenAt: string | null;
};

export type DecayableSubjectStateKind = "memory" | "feel";

export type MemoryLifecyclePolicy = {
  halfLifeHours: Record<DecayableSubjectStateKind, number>;
  fadingThreshold: number;
  archiveThreshold: number;
  /**
   * Time an archived state remains recoverable before its semantic payload is
   * scrubbed. Omitted means forgetting is disabled.
   */
  forgetAfterHours?: number;
  /**
   * Time a forgotten tombstone remains before the row is physically removed.
   * Omitted means physical purge is disabled.
   */
  purgeAfterHours?: number;
};

export type MemoryLifecycleCandidate = {
  stateId: string;
  kind: DecayableSubjectStateKind;
  payload: Record<string, unknown> | null;
  updatedAt: string;
};

export type MemoryLifecycleUpdate = {
  stateId: string;
  expectedUpdatedAt: string;
  nextPayload: Record<string, unknown>;
  lifecycle: SubjectStateLifecycle;
  reason: "initialize" | "decay" | "protected_freeze";
};

export type MemoryLifecycleForget = {
  stateId: string;
  expectedUpdatedAt: string;
  lifecycle: SubjectStateLifecycle;
};

export type MemoryLifecyclePurge = {
  stateId: string;
  expectedUpdatedAt: string;
};

export type MemoryRecallReinforcementContribution = {
  sourceMessageId: string;
  recalledAt: string;
  currentValue: number;
};

export type MemoryRecallContext = {
  conversationId: string;
  epoch: number;
  sourceMessageId: string;
  recalledAt: string;
};

export type MemoryRecallReinforcementUpdate = {
  stateId: string;
  nextPayload: Record<string, unknown>;
  lifecycle: SubjectStateLifecycle;
};

export interface MemoryLifecycleRuntimePort {
  listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<MemoryLifecycleCandidate[]>;

  listForgottenCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<MemoryLifecycleCandidate[]>;

  applyUpdates(input: {
    userId: string;
    subjectId: string;
    updates: readonly MemoryLifecycleUpdate[];
  }): Promise<{ applied: number; conflicts: number }>;

  forgetArchived(input: {
    userId: string;
    subjectId: string;
    forgets: readonly MemoryLifecycleForget[];
  }): Promise<{ applied: number; conflicts: number }>;

  purgeForgotten(input: {
    userId: string;
    subjectId: string;
    purges: readonly MemoryLifecyclePurge[];
  }): Promise<{ applied: number; conflicts: number }>;

  setProtected(input: {
    userId: string;
    subjectId: string;
    stateId: string;
    protected: boolean;
    at: string;
  }): Promise<boolean>;

  archive(input: {
    userId: string;
    subjectId: string;
    stateId: string;
    at: string;
  }): Promise<boolean>;
}

export type MemoryLifecycleRunResult = {
  scanned: number;
  forgottenScanned: number;
  applied: number;
  conflicts: number;
  initialized: number;
  faded: number;
  archived: number;
  forgotten: number;
  purged: number;
};

const LIFECYCLE_KEY = "lifecycle_v1";
const RECALL_REINFORCEMENT_KEY = "recall_reinforcement_v1";
const RECALL_CONTEXT_KEY = "recall_context_v1";
export class MemoryLifecycleService {
  constructor(
    private readonly port: MemoryLifecycleRuntimePort,
    private readonly policy: MemoryLifecyclePolicy,
  ) {
    validatePolicy(policy);
  }

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
  }): Promise<MemoryLifecycleRunResult> {
    const now = normalizeIso(input.now, "now");
    const limit = input.limit ?? 200;
    const candidates = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit,
    });

    const updates = candidates
      .map((candidate) => evaluateLifecycle(candidate, now, this.policy))
      .filter((value): value is MemoryLifecycleUpdate => value !== null);
    const forgets = candidates
      .map((candidate) => evaluateForgetting(candidate, now, this.policy))
      .filter((value): value is MemoryLifecycleForget => value !== null);

    const committed = await this.port.applyUpdates({
      userId: input.userId,
      subjectId: input.subjectId,
      updates,
    });
    const forgotten = await this.port.forgetArchived({
      userId: input.userId,
      subjectId: input.subjectId,
      forgets,
    });

    const forgottenCandidates = await this.port.listForgottenCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit,
    });
    const purges = forgottenCandidates
      .map((candidate) => evaluatePurge(candidate, now, this.policy))
      .filter((value): value is MemoryLifecyclePurge => value !== null);
    const purged = await this.port.purgeForgotten({
      userId: input.userId,
      subjectId: input.subjectId,
      purges,
    });

    return {
      scanned: candidates.length,
      forgottenScanned: forgottenCandidates.length,
      applied: committed.applied + forgotten.applied + purged.applied,
      conflicts:
        committed.conflicts + forgotten.conflicts + purged.conflicts,
      initialized: updates.filter((update) => update.reason === "initialize").length,
      faded: updates.filter((update) => update.lifecycle.status === "fading").length,
      archived: updates.filter((update) => update.lifecycle.status === "archived").length,
      forgotten: forgotten.applied,
      purged: purged.applied,
    };
  }

  setProtected(input: {
    userId: string;
    subjectId: string;
    stateId: string;
    protected: boolean;
    at: string;
  }): Promise<boolean> {
    return this.port.setProtected({
      ...input,
      at: normalizeIso(input.at, "at"),
    });
  }

  archive(input: {
    userId: string;
    subjectId: string;
    stateId: string;
    at: string;
  }): Promise<boolean> {
    return this.port.archive({
      ...input,
      at: normalizeIso(input.at, "at"),
    });
  }
}

export function evaluateLifecycle(
  candidate: MemoryLifecycleCandidate,
  nowIso: string,
  policy: MemoryLifecyclePolicy,
): MemoryLifecycleUpdate | null {
  const now = normalizeIso(nowIso, "now");
  const current = readSubjectStateLifecycle(candidate.payload);

  if (!current) {
    const lifecycle: SubjectStateLifecycle = {
      status: "active",
      salience: 1,
      protected: false,
      lastDecayedAt: now,
      lastRecalledAt: null,
      archivedAt: null,
      forgottenAt: null,
    };
    return {
      stateId: candidate.stateId,
      expectedUpdatedAt: candidate.updatedAt,
      nextPayload: writeSubjectStateLifecycle(candidate.payload, lifecycle),
      lifecycle,
      reason: "initialize",
    };
  }

  if (current.status === "archived" || current.status === "forgotten") {
    return null;
  }

  const nowMs = Date.parse(now);
  const lastMs = Date.parse(current.lastDecayedAt);
  if (nowMs <= lastMs) return null;

  if (current.protected) {
    const lifecycle: SubjectStateLifecycle = {
      ...current,
      lastDecayedAt: now,
    };
    return {
      stateId: candidate.stateId,
      expectedUpdatedAt: candidate.updatedAt,
      nextPayload: writeLifecycleAndRecallReinforcement(
        candidate.payload,
        lifecycle,
        readRecallReinforcementContributions(candidate.payload),
      ),
      lifecycle,
      reason: "protected_freeze",
    };
  }

  const elapsedHours = (nowMs - lastMs) / 3_600_000;
  const halfLifeHours = policy.halfLifeHours[candidate.kind];
  const decayFactor = Math.pow(0.5, elapsedHours / halfLifeHours);
  const salience = clamp01(current.salience * decayFactor);
  const status = lifecycleStatusForSalience(salience, policy);
  const contributions = readRecallReinforcementContributions(
    candidate.payload,
  ).map((contribution) => ({
    ...contribution,
    currentValue: clamp01(contribution.currentValue * decayFactor),
  }));

  const lifecycle: SubjectStateLifecycle = {
    ...current,
    status,
    salience,
    lastDecayedAt: now,
    archivedAt: status === "archived" ? now : null,
    forgottenAt: null,
  };

  return {
    stateId: candidate.stateId,
    expectedUpdatedAt: candidate.updatedAt,
    nextPayload: writeLifecycleAndRecallReinforcement(
      candidate.payload,
      lifecycle,
      contributions,
    ),
    lifecycle,
    reason: "decay",
  };
}

export function evaluateRecallReinforcement(
  candidate: MemoryLifecycleCandidate,
  recalledAtIso: string,
  salienceBoost: number,
  sourceMessageId: string,
  policy?: MemoryLifecyclePolicy,
  context?: {
    conversationId: string;
    epoch: number;
  },
): MemoryRecallReinforcementUpdate | null {
  const recalledAt = normalizeIso(recalledAtIso, "recalledAt");
  const sourceId = sourceMessageId.trim();
  if (!sourceId) {
    throw new Error("Recall sourceMessageId must not be blank.");
  }
  if (
    !Number.isFinite(salienceBoost)
    || salienceBoost < 0
    || salienceBoost > 1
  ) {
    throw new Error("Recall salienceBoost must be between 0 and 1.");
  }
  if (policy) validatePolicy(policy);
  const conversationId = context?.conversationId.trim() ?? null;
  if (
    context
    && (
      !conversationId
      || !Number.isInteger(context.epoch)
      || context.epoch < 0
    )
  ) {
    throw new Error("Recall context must contain a conversation and nonnegative epoch.");
  }

  const current = readSubjectStateLifecycle(candidate.payload);
  if (
    current?.status === "archived"
    || current?.status === "forgotten"
  ) {
    return null;
  }

  const existingContributions =
    readRecallReinforcementContributions(candidate.payload);
  const existingIndex = existingContributions.findIndex(
    (contribution) => contribution.sourceMessageId === sourceId,
  );

  if (
    existingIndex < 0
    && existingContributions.length === 0
    && current?.lastRecalledAt
    && Date.parse(recalledAt) <= Date.parse(current.lastRecalledAt)
  ) {
    // Legacy pre-reinforcement recall metadata has no causal contribution
    // ledger. Do not retroactively invent a boost for an already-recorded
    // historical recall.
    return null;
  }
  if (
    existingIndex >= 0
    && Date.parse(recalledAt)
      <= Date.parse(existingContributions[existingIndex]!.recalledAt)
  ) {
    return null;
  }

  const lifecycleBase: SubjectStateLifecycle = current ?? {
    status: "active",
    salience: 1,
    protected: false,
    lastDecayedAt: recalledAt,
    lastRecalledAt: null,
    archivedAt: null,
    forgottenAt: null,
  };

  const recallMs = Date.parse(recalledAt);
  const lastDecayMs = Date.parse(lifecycleBase.lastDecayedAt);
  let nextLastDecayedAt = lifecycleBase.lastDecayedAt;
  let salience = lifecycleBase.salience;
  let contributions = existingContributions.map((value) => ({ ...value }));
  let effectiveBoost = existingIndex >= 0 ? 0 : salienceBoost;

  if (policy) {
    const halfLifeHours = policy.halfLifeHours[candidate.kind];
    if (!lifecycleBase.protected && recallMs > lastDecayMs) {
      const elapsedHours = (recallMs - lastDecayMs) / 3_600_000;
      const decayFactor = Math.pow(0.5, elapsedHours / halfLifeHours);
      salience = clamp01(salience * decayFactor);
      contributions = contributions.map((contribution) => ({
        ...contribution,
        currentValue: clamp01(
          contribution.currentValue * decayFactor,
        ),
      }));
      nextLastDecayedAt = recalledAt;
    } else if (!lifecycleBase.protected && recallMs < lastDecayMs) {
      const elapsedHours = (lastDecayMs - recallMs) / 3_600_000;
      effectiveBoost *= Math.pow(0.5, elapsedHours / halfLifeHours);
    } else if (recallMs > lastDecayMs) {
      nextLastDecayedAt = recalledAt;
    }
  } else if (recallMs > lastDecayMs) {
    // Decay is disabled, so advancing the checkpoint establishes a new
    // non-retroactive baseline rather than silently aging the state later.
    nextLastDecayedAt = recalledAt;
  }

  if (existingIndex >= 0) {
    contributions[existingIndex] = {
      ...contributions[existingIndex]!,
      recalledAt,
    };
  } else if (effectiveBoost > 0) {
    const beforeBoost = salience;
    salience = clamp01(salience + effectiveBoost);
    contributions.push({
      sourceMessageId: sourceId,
      recalledAt,
      currentValue: salience - beforeBoost,
    });
  }

  const status = policy
    ? lifecycleStatusForSalience(salience, policy)
    : lifecycleBase.status;
  const lifecycle: SubjectStateLifecycle = {
    ...lifecycleBase,
    status,
    salience,
    lastDecayedAt: nextLastDecayedAt,
    lastRecalledAt: recalledAt,
    archivedAt: status === "archived" ? nextLastDecayedAt : null,
    forgottenAt: null,
  };

  const nextPayload = writeLifecycleAndRecallReinforcement(
    candidate.payload,
    lifecycle,
    contributions,
  );
  if (context && conversationId) {
    nextPayload[RECALL_CONTEXT_KEY] = {
      conversationId,
      epoch: context.epoch,
      sourceMessageId: sourceId,
      recalledAt,
    };
  }

  return {
    stateId: candidate.stateId,
    nextPayload,
    lifecycle,
  };
}

export function removeRecallReinforcementSources(
  payload: Record<string, unknown> | null | undefined,
  sourceMessageIds: ReadonlySet<string>,
  policy?: MemoryLifecyclePolicy,
  repairedAtIso?: string,
): {
  nextPayload: Record<string, unknown>;
  lifecycle: SubjectStateLifecycle;
} | null {
  if (sourceMessageIds.size === 0) return null;
  if (policy) validatePolicy(policy);
  const current = readSubjectStateLifecycle(payload);
  if (!current || current.status === "forgotten") return null;

  const contributions = readRecallReinforcementContributions(payload);
  const recallContext = readSubjectStateRecallContext(payload);
  const removed = contributions.filter((contribution) =>
    sourceMessageIds.has(contribution.sourceMessageId)
  );
  const removeRecallContext = Boolean(
    recallContext
    && sourceMessageIds.has(recallContext.sourceMessageId),
  );
  if (removed.length === 0 && !removeRecallContext) return null;

  const surviving = contributions.filter((contribution) =>
    !sourceMessageIds.has(contribution.sourceMessageId)
  );
  const removedValue = removed.reduce(
    (sum, contribution) => sum + contribution.currentValue,
    0,
  );
  const salience = clamp01(current.salience - removedValue);
  const status = policy
    ? lifecycleStatusForSalience(salience, policy)
    : current.status;
  const repairAt = repairedAtIso
    ? normalizeIso(repairedAtIso, "repairedAt")
    : current.lastDecayedAt;
  const removedLatestRecall = removed.some(
    (contribution) => contribution.recalledAt === current.lastRecalledAt,
  ) || Boolean(
    removeRecallContext
    && recallContext?.recalledAt === current.lastRecalledAt,
  );
  const lastRecalledAt = removedLatestRecall
    ? (
        surviving
          .map((contribution) => contribution.recalledAt)
          .sort()
          .at(-1)
        ?? null
      )
    : current.lastRecalledAt;
  const lifecycle: SubjectStateLifecycle = {
    ...current,
    status,
    salience,
    lastRecalledAt,
    archivedAt:
      status === "archived"
        ? current.archivedAt ?? repairAt
        : null,
    forgottenAt: null,
  };

  const nextPayload = writeLifecycleAndRecallReinforcement(
    payload,
    lifecycle,
    surviving,
  );
  if (removeRecallContext) {
    delete nextPayload[RECALL_CONTEXT_KEY];
  }

  return {
    nextPayload,
    lifecycle,
  };
}

export function evaluateForgetting(
  candidate: MemoryLifecycleCandidate,
  nowIso: string,
  policy: MemoryLifecyclePolicy,
): MemoryLifecycleForget | null {
  const now = normalizeIso(nowIso, "now");
  const current = readSubjectStateLifecycle(candidate.payload);
  if (
    !current
    || current.status !== "archived"
    || current.protected
    || !current.archivedAt
  ) {
    return null;
  }

  const retentionHours = policy.forgetAfterHours;
  if (retentionHours === undefined) return null;
  const elapsedHours =
    (Date.parse(now) - Date.parse(current.archivedAt)) / 3_600_000;
  if (elapsedHours < retentionHours) return null;

  return {
    stateId: candidate.stateId,
    expectedUpdatedAt: candidate.updatedAt,
    lifecycle: {
      ...current,
      status: "forgotten",
      salience: 0,
      protected: false,
      lastDecayedAt: now,
      forgottenAt: now,
    },
  };
}

export function evaluatePurge(
  candidate: MemoryLifecycleCandidate,
  nowIso: string,
  policy: MemoryLifecyclePolicy,
): MemoryLifecyclePurge | null {
  const now = normalizeIso(nowIso, "now");
  const current = readSubjectStateLifecycle(candidate.payload);
  if (
    !current
    || current.status !== "forgotten"
    || !current.forgottenAt
  ) {
    return null;
  }
  const retentionHours = policy.purgeAfterHours;
  if (retentionHours === undefined) return null;
  const elapsedHours =
    (Date.parse(now) - Date.parse(current.forgottenAt)) / 3_600_000;
  if (elapsedHours < retentionHours) return null;
  return {
    stateId: candidate.stateId,
    expectedUpdatedAt: candidate.updatedAt,
  };
}

export function readSubjectStateLifecycle(
  payload: Record<string, unknown> | null | undefined,
): SubjectStateLifecycle | null {
  if (!payload || !(LIFECYCLE_KEY in payload)) return null;
  const value = payload[LIFECYCLE_KEY];
  if (!isRecord(value)) {
    throw new Error("Subject-state lifecycle payload must be an object.");
  }

  const status = value.status;
  if (
    status !== "active"
    && status !== "fading"
    && status !== "archived"
    && status !== "forgotten"
  ) {
    throw new Error("Subject-state lifecycle status is invalid.");
  }
  if (
    typeof value.salience !== "number"
    || !Number.isFinite(value.salience)
    || value.salience < 0
    || value.salience > 1
  ) {
    throw new Error("Subject-state lifecycle salience is invalid.");
  }
  if (typeof value.protected !== "boolean") {
    throw new Error("Subject-state lifecycle protected flag is invalid.");
  }

  const lastDecayedAt = normalizeIso(value.lastDecayedAt, "lastDecayedAt");
  const lastRecalledAt = nullableIso(value.lastRecalledAt, "lastRecalledAt");
  const archivedAt = nullableIso(value.archivedAt, "archivedAt");
  const forgottenAt = nullableIso(
    value.forgottenAt === undefined ? null : value.forgottenAt,
    "forgottenAt",
  );

  if (
    (status === "archived" && (archivedAt === null || forgottenAt !== null))
    || (status === "forgotten"
      && (
        archivedAt === null
        || forgottenAt === null
        || value.protected !== false
      ))
    || ((status === "active" || status === "fading")
      && (archivedAt !== null || forgottenAt !== null))
  ) {
    throw new Error(
      "Subject-state lifecycle timestamps do not match status.",
    );
  }

  return {
    status,
    salience: value.salience,
    protected: value.protected,
    lastDecayedAt,
    lastRecalledAt,
    archivedAt,
    forgottenAt,
  };
}

export function writeSubjectStateLifecycle(
  payload: Record<string, unknown> | null | undefined,
  lifecycle: SubjectStateLifecycle,
): Record<string, unknown> {
  return {
    ...(payload ?? {}),
    [LIFECYCLE_KEY]: lifecycle,
  };
}

export function readSubjectStateRecallContext(
  payload: Record<string, unknown> | null | undefined,
): MemoryRecallContext | null {
  if (!payload || !(RECALL_CONTEXT_KEY in payload)) return null;
  const value = payload[RECALL_CONTEXT_KEY];
  if (!isRecord(value)) {
    throw new Error("Recall context payload must be an object.");
  }
  const conversationId =
    typeof value.conversationId === "string"
      ? value.conversationId.trim()
      : "";
  const sourceMessageId =
    typeof value.sourceMessageId === "string"
      ? value.sourceMessageId.trim()
      : "";
  if (
    !conversationId
    || !sourceMessageId
    || !Number.isInteger(value.epoch)
    || (value.epoch as number) < 0
  ) {
    throw new Error("Recall context payload is invalid.");
  }

  return {
    conversationId,
    epoch: value.epoch as number,
    sourceMessageId,
    recalledAt: normalizeIso(value.recalledAt, "recalledAt"),
  };
}

export function readRecallReinforcementContributions(
  payload: Record<string, unknown> | null | undefined,
): MemoryRecallReinforcementContribution[] {
  if (!payload || !(RECALL_REINFORCEMENT_KEY in payload)) return [];
  const value = payload[RECALL_REINFORCEMENT_KEY];
  if (!isRecord(value) || !Array.isArray(value.contributions)) {
    throw new Error("Recall reinforcement payload must contain contributions.");
  }

  return value.contributions.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error("Recall reinforcement contribution must be an object.");
    }
    const sourceMessageId =
      typeof candidate.sourceMessageId === "string"
        ? candidate.sourceMessageId.trim()
        : "";
    if (!sourceMessageId) {
      throw new Error("Recall reinforcement sourceMessageId is invalid.");
    }
    const recalledAt = normalizeIso(candidate.recalledAt, "recalledAt");
    if (
      typeof candidate.currentValue !== "number"
      || !Number.isFinite(candidate.currentValue)
      || candidate.currentValue < 0
      || candidate.currentValue > 1
    ) {
      throw new Error("Recall reinforcement currentValue is invalid.");
    }
    return {
      sourceMessageId,
      recalledAt,
      currentValue: candidate.currentValue,
    };
  });
}

function writeLifecycleAndRecallReinforcement(
  payload: Record<string, unknown> | null | undefined,
  lifecycle: SubjectStateLifecycle,
  contributions: readonly MemoryRecallReinforcementContribution[],
): Record<string, unknown> {
  const next = writeSubjectStateLifecycle(payload, lifecycle);
  if (contributions.length === 0) {
    delete next[RECALL_REINFORCEMENT_KEY];
    return next;
  }
  next[RECALL_REINFORCEMENT_KEY] = {
    contributions: contributions.map((contribution) => ({
      ...contribution,
    })),
  };
  return next;
}

export function forgottenSubjectStatePayload(
  lifecycle: SubjectStateLifecycle,
): Record<string, unknown> {
  if (lifecycle.status !== "forgotten" || !lifecycle.forgottenAt) {
    throw new Error(
      "Forgotten Subject State payload requires forgotten lifecycle.",
    );
  }
  return {
    [LIFECYCLE_KEY]: lifecycle,
  };
}

function lifecycleStatusForSalience(
  salience: number,
  policy: MemoryLifecyclePolicy,
): SubjectStateLifecycleStatus {
  return salience <= policy.archiveThreshold
    ? "archived"
    : salience <= policy.fadingThreshold
      ? "fading"
      : "active";
}

function validatePolicy(policy: MemoryLifecyclePolicy): void {
  for (const kind of ["memory", "feel"] as const) {
    const halfLife = policy.halfLifeHours[kind];
    if (!Number.isFinite(halfLife) || halfLife <= 0) {
      throw new Error(`Decay half-life for ${kind} must be positive.`);
    }
  }
  if (
    !Number.isFinite(policy.archiveThreshold)
    || !Number.isFinite(policy.fadingThreshold)
    || policy.archiveThreshold < 0
    || policy.fadingThreshold > 1
    || policy.archiveThreshold >= policy.fadingThreshold
  ) {
    throw new Error(
      "Decay thresholds must satisfy 0 <= archive < fading <= 1.",
    );
  }
  for (const [label, value] of [
    ["forgetAfterHours", policy.forgetAfterHours],
    ["purgeAfterHours", policy.purgeAfterHours],
  ] as const) {
    if (
      value !== undefined
      && (!Number.isFinite(value) || value < 0)
    ) {
      throw new Error(`${label} must be a non-negative finite number.`);
    }
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

function nullableIso(value: unknown, label: string): string | null {
  return value === null ? null : normalizeIso(value, label);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
