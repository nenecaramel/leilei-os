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
   * scrubbed. Defaults to 30 days.
   */
  forgetAfterHours?: number;
  /**
   * Time a forgotten tombstone remains before the row is physically removed.
   * Defaults to 30 days.
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
export const DEFAULT_MEMORY_FORGET_AFTER_HOURS = 30 * 24;
export const DEFAULT_MEMORY_PURGE_AFTER_HOURS = 30 * 24;

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
      nextPayload: writeSubjectStateLifecycle(candidate.payload, lifecycle),
      lifecycle,
      reason: "protected_freeze",
    };
  }

  const elapsedHours = (nowMs - lastMs) / 3_600_000;
  const halfLifeHours = policy.halfLifeHours[candidate.kind];
  const salience = clamp01(
    current.salience * Math.pow(0.5, elapsedHours / halfLifeHours),
  );
  const status = lifecycleStatusForSalience(salience, policy);

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
    nextPayload: writeSubjectStateLifecycle(candidate.payload, lifecycle),
    lifecycle,
    reason: "decay",
  };
}

export function evaluateRecallReinforcement(
  candidate: MemoryLifecycleCandidate,
  recalledAtIso: string,
  salienceBoost: number,
  policy?: MemoryLifecyclePolicy,
): MemoryRecallReinforcementUpdate | null {
  const recalledAt = normalizeIso(recalledAtIso, "recalledAt");
  if (
    !Number.isFinite(salienceBoost)
    || salienceBoost < 0
    || salienceBoost > 1
  ) {
    throw new Error("Recall salienceBoost must be between 0 and 1.");
  }
  if (policy) validatePolicy(policy);

  const current = readSubjectStateLifecycle(candidate.payload);
  if (
    current?.status === "archived"
    || current?.status === "forgotten"
  ) {
    return null;
  }
  if (
    current?.lastRecalledAt
    && Date.parse(recalledAt) <= Date.parse(current.lastRecalledAt)
  ) {
    return null;
  }

  if (!current) {
    const lifecycle: SubjectStateLifecycle = {
      status: "active",
      salience: 1,
      protected: false,
      lastDecayedAt: recalledAt,
      lastRecalledAt: recalledAt,
      archivedAt: null,
      forgottenAt: null,
    };
    return {
      stateId: candidate.stateId,
      nextPayload: writeSubjectStateLifecycle(candidate.payload, lifecycle),
      lifecycle,
    };
  }

  const recallMs = Date.parse(recalledAt);
  const lastDecayMs = Date.parse(current.lastDecayedAt);
  let nextLastDecayedAt = current.lastDecayedAt;
  let salience = current.salience;

  if (policy) {
    const halfLifeHours = policy.halfLifeHours[candidate.kind];
    if (!current.protected && recallMs > lastDecayMs) {
      const elapsedHours = (recallMs - lastDecayMs) / 3_600_000;
      salience *= Math.pow(0.5, elapsedHours / halfLifeHours);
      nextLastDecayedAt = recalledAt;
      salience = clamp01(salience + salienceBoost);
    } else if (!current.protected && recallMs < lastDecayMs) {
      const elapsedHours = (lastDecayMs - recallMs) / 3_600_000;
      const caughtUpBoost =
        salienceBoost * Math.pow(0.5, elapsedHours / halfLifeHours);
      salience = clamp01(salience + caughtUpBoost);
    } else {
      if (recallMs > lastDecayMs) nextLastDecayedAt = recalledAt;
      salience = clamp01(salience + salienceBoost);
    }
  } else {
    salience = clamp01(salience + salienceBoost);
    if (recallMs > lastDecayMs) {
      // Decay is disabled, so advancing the checkpoint establishes a new
      // non-retroactive baseline rather than silently aging the state later.
      nextLastDecayedAt = recalledAt;
    }
  }

  const status = policy
    ? lifecycleStatusForSalience(salience, policy)
    : current.status;
  const lifecycle: SubjectStateLifecycle = {
    ...current,
    status,
    salience,
    lastDecayedAt: nextLastDecayedAt,
    lastRecalledAt: recalledAt,
    archivedAt: status === "archived" ? nextLastDecayedAt : null,
    forgottenAt: null,
  };

  return {
    stateId: candidate.stateId,
    nextPayload: writeSubjectStateLifecycle(candidate.payload, lifecycle),
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

  const elapsedHours =
    (Date.parse(now) - Date.parse(current.archivedAt)) / 3_600_000;
  if (elapsedHours < forgetAfterHours(policy)) return null;

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
  const elapsedHours =
    (Date.parse(now) - Date.parse(current.forgottenAt)) / 3_600_000;
  if (elapsedHours < purgeAfterHours(policy)) return null;
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

function forgetAfterHours(policy: MemoryLifecyclePolicy): number {
  return policy.forgetAfterHours ?? DEFAULT_MEMORY_FORGET_AFTER_HOURS;
}

function purgeAfterHours(policy: MemoryLifecyclePolicy): number {
  return policy.purgeAfterHours ?? DEFAULT_MEMORY_PURGE_AFTER_HOURS;
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
