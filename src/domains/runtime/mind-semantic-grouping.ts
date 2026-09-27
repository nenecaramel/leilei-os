import type {
  BreathSemanticCandidate,
} from "./breath-semantic-recall.js";

export type MindSemanticGroupingKind =
  | "drive"
  | "thought"
  | "curiosity"
  | "topic";

export type MindSemanticThreadGroup = {
  threadKey: string;
  anchorStateId: string;
  anchorText: string;
  createdAt: string;
  newThread: boolean;
};

export type MindSemanticGroupingMatch = {
  queryStateId: string;
  candidateStateId: string;
  score: number;
};

export type MindSemanticGroupingPolicy = {
  threshold: number;
  candidateLimit: number;
};

export type MindSemanticGroupingFallbackCode =
  | "E5_PROVIDER_UNAVAILABLE"
  | "E5_SCORING_FAILED";

export type MindSemanticGroupingReservation = {
  reservationId: string;
  query: string;
  candidates: BreathSemanticCandidate[];
};

export interface MindSemanticGroupingPort {
  listCompletedMatches(input: {
    userId: string;
    subjectId: string;
    kind: MindSemanticGroupingKind;
    stateIds: readonly string[];
  }): Promise<readonly MindSemanticGroupingMatch[]>;

  stage(input: {
    userId: string;
    subjectId: string;
    kind: MindSemanticGroupingKind;
    queryStateId: string;
    query: string;
    candidates: readonly BreathSemanticCandidate[];
  }): Promise<boolean>;
}

export type MindSemanticGroupingResult = {
  canonicalThreadKeyByThread: ReadonlyMap<string, string>;
  staged: number;
};

export class MindSemanticGroupingService {
  constructor(
    private readonly port: MindSemanticGroupingPort,
    private readonly policy: MindSemanticGroupingPolicy,
  ) {
    if (
      !Number.isFinite(policy.threshold)
      || policy.threshold <= 0
      || policy.threshold > 1
    ) {
      throw new Error(
        "Mind semantic grouping threshold must be greater than 0 and at most 1.",
      );
    }
    if (
      !Number.isInteger(policy.candidateLimit)
      || policy.candidateLimit < 1
      || policy.candidateLimit > 64
    ) {
      throw new Error(
        "Mind semantic grouping candidateLimit must be an integer from 1 to 64.",
      );
    }
  }

  async reconcile(input: {
    userId: string;
    subjectId: string;
    kind: MindSemanticGroupingKind;
    groups: readonly MindSemanticThreadGroup[];
  }): Promise<MindSemanticGroupingResult> {
    const groups = [...input.groups]
      .filter((group) =>
        Boolean(
          group.threadKey.trim()
          && group.anchorStateId.trim()
          && group.anchorText.trim(),
        )
      )
      .sort(compareGroups);

    const canonicalThreadKeyByThread = new Map(
      groups.map((group) => [group.threadKey, group.threadKey]),
    );
    if (groups.length <= 1) {
      return { canonicalThreadKeyByThread, staged: 0 };
    }

    const byStateId = new Map(
      groups.map((group) => [group.anchorStateId, group]),
    );
    const parent = new Map(
      groups.map((group) => [group.threadKey, group.threadKey]),
    );

    const find = (key: string): string => {
      const current = parent.get(key) ?? key;
      if (current === key) return key;
      const root = find(current);
      parent.set(key, root);
      return root;
    };
    const unite = (leftKey: string, rightKey: string): void => {
      const leftRoot = find(leftKey);
      const rightRoot = find(rightKey);
      if (leftRoot === rightRoot) return;
      const left = groups.find((group) => group.threadKey === leftRoot);
      const right = groups.find((group) => group.threadKey === rightRoot);
      if (!left || !right) return;
      const [canonical, other] =
        compareGroups(left, right) <= 0
          ? [left, right]
          : [right, left];
      parent.set(other.threadKey, canonical.threadKey);
    };

    const matches = await this.port.listCompletedMatches({
      userId: input.userId,
      subjectId: input.subjectId,
      kind: input.kind,
      stateIds: groups.map((group) => group.anchorStateId),
    });
    for (const match of matches) {
      if (
        !Number.isFinite(match.score)
        || match.score < this.policy.threshold
        || match.score > 1
      ) {
        continue;
      }
      const query = byStateId.get(match.queryStateId);
      const candidate = byStateId.get(match.candidateStateId);
      if (!query || !candidate) continue;
      unite(query.threadKey, candidate.threadKey);
    }

    for (const group of groups) {
      canonicalThreadKeyByThread.set(group.threadKey, find(group.threadKey));
    }

    let staged = 0;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index]!;
      if (!group.newThread) continue;
      if (
        canonicalThreadKeyByThread.get(group.threadKey) !== group.threadKey
      ) {
        continue;
      }
      const earlier = groups
        .slice(0, index)
        .filter(
          (candidate) =>
            find(candidate.threadKey) !== find(group.threadKey),
        )
        .slice(-this.policy.candidateLimit)
        .reverse();
      if (earlier.length === 0) continue;

      const applied = await this.port.stage({
        userId: input.userId,
        subjectId: input.subjectId,
        kind: input.kind,
        queryStateId: group.anchorStateId,
        query: group.anchorText,
        candidates: earlier.map((candidate) => ({
          stateId: candidate.anchorStateId,
          kind: input.kind,
          text: candidate.anchorText,
        })),
      });
      if (applied) staged += 1;
    }

    return { canonicalThreadKeyByThread, staged };
  }
}

function compareGroups(
  left: MindSemanticThreadGroup,
  right: MindSemanticThreadGroup,
): number {
  return Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.anchorStateId.localeCompare(right.anchorStateId);
}
