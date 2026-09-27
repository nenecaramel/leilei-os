import {
  inspectMindRetirementCandidate,
  type MindRetirementRuntimePort,
} from "./mind-retirement.js";
import type {
  MindRetirementKind,
} from "./mind-retirement-policy.js";

export const DEFAULT_MIND_RETIREMENT_PREVIEW_RETENTION_HOURS = [
  168,
  336,
  720,
  2160,
  4320,
] as const;

const RETIREMENT_KINDS: readonly MindRetirementKind[] = [
  "drive",
  "thought",
  "curiosity",
  "topic",
];

export type MindRetirementPreviewKindStats = {
  kind: MindRetirementKind;
  scannedAnchors: number;
  terminalAnchors: number;
  nonTerminalAnchors: number;
  unreadableAnchors: number;
  terminalAgeHours: {
    min: number;
    p50: number;
    p90: number;
    max: number;
  } | null;
  eligibleByRetention: Array<{
    retentionHours: number;
    threads: number;
  }>;
};

export type MindRetirementPreview = {
  asOf: string;
  scannedAnchors: number;
  truncated: boolean;
  retentionHours: number[];
  kinds: MindRetirementPreviewKindStats[];
};

type PreviewPort = Pick<MindRetirementRuntimePort, "listCandidates">;

export class MindRetirementPreviewService {
  constructor(private readonly port: PreviewPort) {}

  async preview(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
    retentionHours?: readonly number[];
  }): Promise<MindRetirementPreview> {
    const now = normalizeIso(input.now, "now");
    const nowMs = Date.parse(now);
    const limit = input.limit ?? 2_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw new Error(
        "Mind retirement preview limit must be an integer from 1 to 10000.",
      );
    }
    const retentionHours = normalizeRetentionHours(
      input.retentionHours
        ?? DEFAULT_MIND_RETIREMENT_PREVIEW_RETENTION_HOURS,
    );

    const fetched = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit: limit + 1,
    });
    const truncated = fetched.length > limit;
    const candidates = fetched.slice(0, limit);
    const agesByKind = new Map<
      MindRetirementKind,
      { stats: MindRetirementPreviewKindStats; ages: number[] }
    >(
      RETIREMENT_KINDS.map((kind) => [
        kind,
        {
          stats: {
            kind,
            scannedAnchors: 0,
            terminalAnchors: 0,
            nonTerminalAnchors: 0,
            unreadableAnchors: 0,
            terminalAgeHours: null,
            eligibleByRetention: [],
          },
          ages: [],
        },
      ]),
    );

    for (const candidate of candidates) {
      const bucket = agesByKind.get(candidate.kind);
      if (!bucket) continue;
      bucket.stats.scannedAnchors += 1;

      let inspected;
      try {
        inspected = inspectMindRetirementCandidate(candidate);
      } catch {
        bucket.stats.unreadableAnchors += 1;
        continue;
      }
      if (!inspected || inspected.role !== "anchor") {
        bucket.stats.unreadableAnchors += 1;
        continue;
      }
      if (!inspected.terminalAt) {
        bucket.stats.nonTerminalAnchors += 1;
        continue;
      }

      const terminalAtMs = Date.parse(inspected.terminalAt);
      if (!Number.isFinite(terminalAtMs)) {
        bucket.stats.unreadableAnchors += 1;
        continue;
      }
      bucket.stats.terminalAnchors += 1;
      bucket.ages.push(
        roundHours(Math.max(0, (nowMs - terminalAtMs) / 3_600_000)),
      );
    }

    const kinds = RETIREMENT_KINDS.map((kind) => {
      const bucket = agesByKind.get(kind);
      if (!bucket) {
        throw new Error("Mind retirement preview kind bucket is missing.");
      }
      const ages = [...bucket.ages].sort((left, right) => left - right);
      bucket.stats.terminalAgeHours =
        ages.length === 0
          ? null
          : {
              min: ages[0]!,
              p50: percentile(ages, 0.5),
              p90: percentile(ages, 0.9),
              max: ages[ages.length - 1]!,
            };
      bucket.stats.eligibleByRetention = retentionHours.map(
        (retention) => ({
          retentionHours: retention,
          threads: ages.filter((age) => age >= retention).length,
        }),
      );
      return bucket.stats;
    });

    return {
      asOf: now,
      scannedAnchors: candidates.length,
      truncated,
      retentionHours,
      kinds,
    };
  }
}

function normalizeRetentionHours(values: readonly number[]): number[] {
  if (values.length === 0) {
    throw new Error(
      "Mind retirement preview requires at least one retention horizon.",
    );
  }
  const normalized = [...new Set(values)];
  if (
    normalized.some(
      (value) =>
        typeof value !== "number"
        || !Number.isFinite(value)
        || value <= 0,
    )
  ) {
    throw new Error(
      "Mind retirement preview retention horizons must be positive.",
    );
  }
  return normalized.sort((left, right) => left - right);
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.floor((sorted.length - 1) * fraction);
  return sorted[index]!;
}

function roundHours(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeIso(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(
      `Mind retirement preview ${label} must be an ISO timestamp.`,
    );
  }
  return new Date(parsed).toISOString();
}
