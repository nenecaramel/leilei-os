import type { SubjectStateKind, SubjectStateWrite } from "./subject-state-contract.js";
import { isConsolidationEligible } from "./runtime-status-axes.js";

export const BREATH_RECALL_KINDS = ["memory", "feel"] as const satisfies readonly SubjectStateKind[];

export type BreathRecallHit = {
  state: SubjectStateWrite;
  score: number;
  matchedTokens: string[];
};

function tokens(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase().normalize("NFKC");
  const result = new Set<string>();

  for (const token of normalized.match(/[a-z0-9_'-]+/g) ?? []) {
    if (token.length > 1) result.add(token);
  }

  for (const sequence of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    const chars = Array.from(sequence);
    for (const char of chars) result.add(char);
    for (let index = 0; index + 1 < chars.length; index += 1) {
      result.add(`${chars[index]}${chars[index + 1]}`);
    }
  }

  return result;
}

function scopeApplies(
  state: SubjectStateWrite,
  input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    currentPathMessageIds: ReadonlySet<string>;
  },
): boolean {
  const scope = state.envelope.scope;
  if (scope.userId !== input.userId || scope.subjectId !== input.subjectId) {
    return false;
  }

  if (scope.applicability === "global") return true;
  if (scope.conversationId !== input.conversationId) return false;
  if (scope.applicability === "conversation") return true;

  return Boolean(
    scope.pathHeadMessageId
    && input.currentPathMessageIds.has(scope.pathHeadMessageId),
  );
}

export function recallBreath(
  query: string,
  candidates: readonly SubjectStateWrite[],
  input: {
    userId: string;
    subjectId: string;
    conversationId: string;
    currentPathMessageIds: ReadonlySet<string>;
    limit: number;
  },
): BreathRecallHit[] {
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error("Breath recall limit must be a positive integer.");
  }

  const queryTokens = tokens(query);
  if (queryTokens.size === 0) return [];

  const allowedKinds = new Set<SubjectStateKind>(BREATH_RECALL_KINDS);
  const hits: BreathRecallHit[] = [];

  for (const state of candidates) {
    if (
      !allowedKinds.has(state.kind)
      || !isConsolidationEligible(state.envelope.status)
      || !scopeApplies(state, input)
      || !state.text
    ) {
      continue;
    }

    const candidateTokens = tokens(state.text);
    if (candidateTokens.size === 0) continue;

    const matchedTokens = [...queryTokens].filter((token) =>
      candidateTokens.has(token),
    );
    if (matchedTokens.length === 0) continue;

    const score =
      matchedTokens.length
      / Math.sqrt(queryTokens.size * candidateTokens.size);

    hits.push({ state, score, matchedTokens });
  }

  return hits
    .sort((left, right) =>
      right.score - left.score
      || left.state.id.localeCompare(right.state.id),
    )
    .slice(0, input.limit);
}
