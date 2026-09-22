export type SubjectStateLifecycleStatus =
  | "active"
  | "fading"
  | "archived";

export type SubjectStateLifecycle = {
  status: SubjectStateLifecycleStatus;
  salience: number;
  protected: boolean;
  lastDecayedAt: string;
  lastRecalledAt: string | null;
  archivedAt: string | null;
};

export type DecayableSubjectStateKind = "memory" | "feel";

export type MemoryLifecyclePolicy = {
  halfLifeHours: Record<DecayableSubjectStateKind, number>;
  fadingThreshold: number;
  archiveThreshold: number;
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

export interface MemoryLifecycleRuntimePort {
  listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<MemoryLifecycleCandidate[]>;

  applyUpdates(input: {
    userId: string;
    subjectId: string;
    updates: readonly MemoryLifecycleUpdate[];
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
  applied: number;
  conflicts: number;
  initialized: number;
  faded: number;
  archived: number;
};

const LIFECYCLE_KEY = "lifecycle_v1";

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
    const candidates = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: input.limit ?? 200,
    });

    const updates = candidates
      .map((candidate) => evaluateLifecycle(candidate, now, this.policy))
      .filter((value): value is MemoryLifecycleUpdate => value !== null);

    const committed = await this.port.applyUpdates({
      userId: input.userId,
      subjectId: input.subjectId,
      updates,
    });

    return {
      scanned: candidates.length,
      applied: committed.applied,
      conflicts: committed.conflicts,
      initialized: updates.filter((update) => update.reason === "initialize").length,
      faded: updates.filter((update) => update.lifecycle.status === "fading").length,
      archived: updates.filter((update) => update.lifecycle.status === "archived").length,
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
    };
    return {
      stateId: candidate.stateId,
      expectedUpdatedAt: candidate.updatedAt,
      nextPayload: writeSubjectStateLifecycle(candidate.payload, lifecycle),
      lifecycle,
      reason: "initialize",
    };
  }

  if (current.status === "archived") return null;

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
  const status: SubjectStateLifecycleStatus =
    salience <= policy.archiveThreshold
      ? "archived"
      : salience <= policy.fadingThreshold
        ? "fading"
        : "active";

  const lifecycle: SubjectStateLifecycle = {
    ...current,
    status,
    salience,
    lastDecayedAt: now,
    archivedAt: status === "archived" ? now : null,
  };

  return {
    stateId: candidate.stateId,
    expectedUpdatedAt: candidate.updatedAt,
    nextPayload: writeSubjectStateLifecycle(candidate.payload, lifecycle),
    lifecycle,
    reason: "decay",
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
  if (status !== "active" && status !== "fading" && status !== "archived") {
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
  const lastRecalledAt =
    value.lastRecalledAt === null
      ? null
      : normalizeIso(value.lastRecalledAt, "lastRecalledAt");
  const archivedAt =
    value.archivedAt === null
      ? null
      : normalizeIso(value.archivedAt, "archivedAt");

  if (
    (status === "archived" && archivedAt === null)
    || (status !== "archived" && archivedAt !== null)
  ) {
    throw new Error("Subject-state lifecycle archivedAt does not match status.");
  }

  return {
    status,
    salience: value.salience,
    protected: value.protected,
    lastDecayedAt,
    lastRecalledAt,
    archivedAt,
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
    throw new Error("Decay thresholds must satisfy 0 <= archive < fading <= 1.");
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
