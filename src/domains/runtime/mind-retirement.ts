import {
  readCuriosityEvolution,
} from "./curiosity-evolution.js";
import {
  readDriveEvolution,
} from "./drive-evolution.js";
import {
  readThoughtEvolution,
} from "./thought-evolution.js";
import {
  readTopicEvolution,
} from "./topic-evolution.js";
import {
  validateMindRetirementPolicy,
  type MindRetirementKind,
  type MindRetirementPolicy,
} from "./mind-retirement-policy.js";

export type MindRetirementCandidate = {
  stateId: string;
  kind: MindRetirementKind;
  payload: Record<string, unknown> | null;
  updatedAt: string;
};

export type MindRetirementPlan = {
  kind: MindRetirementKind;
  anchorStateId: string;
  threadKey: string;
  terminalAt: string;
  retentionHours: number;
  expectedUpdatedAt: string;
};

export type MindRetirementCommitInput = MindRetirementPlan & {
  userId: string;
  subjectId: string;
  retiredAt: string;
};

export interface MindRetirementRuntimePort {
  listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<MindRetirementCandidate[]>;

  retireThread(
    input: MindRetirementCommitInput,
  ): Promise<
    | { outcome: "retired"; deleted: number }
    | { outcome: "conflict"; deleted: 0 }
  >;
}

export type MindRetirementRunResult = {
  scanned: number;
  eligible: number;
  retiredThreads: number;
  deletedStates: number;
  conflicts: number;
};

export class MindRetirementService {
  private readonly policy: MindRetirementPolicy;

  constructor(
    private readonly port: MindRetirementRuntimePort,
    policy: MindRetirementPolicy,
  ) {
    this.policy = validateMindRetirementPolicy(policy);
  }

  async runOnce(input: {
    userId: string;
    subjectId: string;
    now: string;
    limit?: number;
  }): Promise<MindRetirementRunResult> {
    const now = normalizeIso(input.now, "now");
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("Mind retirement limit must be a positive integer.");
    }

    const candidates = await this.port.listCandidates({
      userId: input.userId,
      subjectId: input.subjectId,
      limit,
    });
    let eligible = 0;
    let retiredThreads = 0;
    let deletedStates = 0;
    let conflicts = 0;

    for (const candidate of candidates) {
      let plan: MindRetirementPlan | null;
      try {
        plan = planMindRetirement(candidate, now, this.policy);
      } catch {
        // Lifecycle payload corruption is not a reason to guess destructive
        // eligibility. Leave the row intact for explicit repair.
        continue;
      }
      if (!plan) continue;
      eligible += 1;

      const committed = await this.port.retireThread({
        ...plan,
        userId: input.userId,
        subjectId: input.subjectId,
        retiredAt: now,
      });
      if (committed.outcome === "retired") {
        retiredThreads += 1;
        deletedStates += committed.deleted;
      } else {
        conflicts += 1;
      }
    }

    return {
      scanned: candidates.length,
      eligible,
      retiredThreads,
      deletedStates,
      conflicts,
    };
  }
}

export function planMindRetirement(
  candidate: MindRetirementCandidate,
  nowIso: string,
  policy: MindRetirementPolicy,
): MindRetirementPlan | null {
  const validated = validateMindRetirementPolicy(policy);
  const rule = validated[candidate.kind];
  if (!rule) return null;

  const terminal = readTerminalThreadState(candidate);
  if (!terminal || terminal.role !== "anchor") return null;
  const now = normalizeIso(nowIso, "now");
  if (!retentionElapsed(terminal.terminalAt, now, rule.retentionHours)) {
    return null;
  }

  return {
    kind: candidate.kind,
    anchorStateId: terminal.anchorStateId,
    threadKey: terminal.threadKey,
    terminalAt: terminal.terminalAt,
    retentionHours: rule.retentionHours,
    expectedUpdatedAt: normalizeIso(candidate.updatedAt, "updatedAt"),
  };
}

export function selectRetirableThreadMembers(
  candidates: readonly MindRetirementCandidate[],
  plan: MindRetirementPlan,
  nowIso: string,
): string[] | null {
  const now = normalizeIso(nowIso, "now");
  const members = candidates.flatMap((candidate) => {
    if (candidate.kind !== plan.kind) return [];
    let terminal: TerminalThreadState | null;
    try {
      terminal = readTerminalThreadState(candidate);
    } catch {
      return [];
    }
    if (
      !terminal
      || terminal.threadKey !== plan.threadKey
      || terminal.anchorStateId !== plan.anchorStateId
    ) {
      return [];
    }
    return [{ candidate, terminal }];
  });

  if (
    members.length === 0
    || !members.some(({ candidate }) =>
      candidate.stateId === plan.anchorStateId
    )
  ) {
    return null;
  }

  for (const { terminal } of members) {
    if (
      !retentionElapsed(
        terminal.terminalAt,
        now,
        plan.retentionHours,
      )
    ) {
      return null;
    }
  }

  return members
    .map(({ candidate }) => candidate.stateId)
    .sort((left, right) => left.localeCompare(right));
}

type TerminalThreadState = {
  role: "anchor" | "reinforcement";
  threadKey: string;
  anchorStateId: string;
  terminalAt: string;
};

function readTerminalThreadState(
  candidate: MindRetirementCandidate,
): TerminalThreadState | null {
  switch (candidate.kind) {
    case "drive": {
      const evolution = readDriveEvolution(candidate.payload);
      if (
        !evolution
        || evolution.phase !== "dormant"
        || !evolution.dormantAt
      ) {
        return null;
      }
      return {
        role: evolution.role,
        threadKey: evolution.threadKey,
        anchorStateId: evolution.anchorStateId,
        terminalAt: evolution.dormantAt,
      };
    }
    case "thought": {
      const evolution = readThoughtEvolution(candidate.payload);
      if (
        !evolution
        || evolution.phase !== "dormant"
        || !evolution.dormantAt
      ) {
        return null;
      }
      return {
        role: evolution.role,
        threadKey: evolution.threadKey,
        anchorStateId: evolution.anchorStateId,
        terminalAt: evolution.dormantAt,
      };
    }
    case "curiosity": {
      const evolution = readCuriosityEvolution(candidate.payload);
      if (!evolution) return null;
      const terminalAt =
        evolution.phase === "dormant"
          ? evolution.dormantAt
          : evolution.phase === "resolved"
            ? evolution.resolvedAt
            : null;
      if (!terminalAt) return null;
      return {
        role: evolution.role,
        threadKey: evolution.threadKey,
        anchorStateId: evolution.anchorStateId,
        terminalAt,
      };
    }
    case "topic": {
      const evolution = readTopicEvolution(candidate.payload);
      if (
        !evolution
        || evolution.phase !== "dormant"
        || !evolution.dormantAt
      ) {
        return null;
      }
      return {
        role: evolution.role,
        threadKey: evolution.threadKey,
        anchorStateId: evolution.anchorStateId,
        terminalAt: evolution.dormantAt,
      };
    }
  }
}

function retentionElapsed(
  terminalAtIso: string,
  nowIso: string,
  retentionHours: number,
): boolean {
  const terminalAt = Date.parse(normalizeIso(terminalAtIso, "terminalAt"));
  const now = Date.parse(normalizeIso(nowIso, "now"));
  return now - terminalAt >= retentionHours * 3_600_000;
}

function normalizeIso(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Mind retirement ${label} must be an ISO timestamp.`);
  }
  return new Date(parsed).toISOString();
}
