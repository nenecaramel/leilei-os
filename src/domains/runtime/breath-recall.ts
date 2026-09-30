import type { SubjectStateKind, SubjectStateWrite } from "./subject-state-contract.js";
import { isConsolidationEligible } from "./runtime-status-axes.js";
import { readSubjectStateLifecycle } from "./memory-lifecycle.js";

export const BREATH_RECALL_KINDS = ["memory", "feel"] as const satisfies readonly SubjectStateKind[];

export type BreathRecallHit = {
  state: SubjectStateWrite;
  score: number;
  lexicalScore: number;
  semanticScore: number | null;
  salience: number;
  matchedTokens: string[];
  channel: "lexical" | "semantic" | "hybrid";
};

export type BreathEligibilityInput = {
  userId: string;
  subjectId: string;
  conversationId: string;
  currentPathMessageIds: ReadonlySet<string>;
  now?: string;
  cooldownHours?: number;
};

function tokens(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase().normalize("NFKC");
  const result = new Set<string>();

  for (const token of normalized.match(/[a-z0-9_'-]+/g) ?? []) {
    if (token.length > 1) result.add(token);
  }

  for (const sequence of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    const chars = Array.from(sequence);
    for (let index = 0; index + 1 < chars.length; index += 1) {
      result.add(`${chars[index]}${chars[index + 1]}`);
    }
  }

  return result;
}

export function breathLexicalScore(
  query: string,
  candidateText: string,
): number {
  const queryTokens = tokens(query);
  const candidateTokens = tokens(candidateText);
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;

  let matched = 0;
  for (const token of queryTokens) {
    if (candidateTokens.has(token)) matched += 1;
  }
  return matched === 0
    ? 0
    : matched / Math.sqrt(queryTokens.size * candidateTokens.size);
}

function dedupeKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
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

function parseCooldownNow(
  cooldownHours: number,
  now?: string,
): number | null {
  if (!Number.isFinite(cooldownHours) || cooldownHours < 0) {
    throw new Error("Breath cooldownHours must be a non-negative number.");
  }
  if (cooldownHours === 0) return null;
  if (!now) {
    throw new Error("Breath recall requires now when cooldownHours is enabled.");
  }
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) {
    throw new Error("Breath recall now must be an ISO timestamp.");
  }
  return parsed;
}

function eligibleBreathEntries(
  candidates: readonly SubjectStateWrite[],
  input: BreathEligibilityInput,
): Array<{
  state: SubjectStateWrite;
  lifecycle: ReturnType<typeof readSubjectStateLifecycle>;
}> {
  const cooldownHours = input.cooldownHours ?? 0;
  const nowMs = parseCooldownNow(cooldownHours, input.now);
  const allowedKinds = new Set<SubjectStateKind>(BREATH_RECALL_KINDS);
  const eligible: Array<{
    state: SubjectStateWrite;
    lifecycle: ReturnType<typeof readSubjectStateLifecycle>;
  }> = [];

  for (const state of candidates) {
    let lifecycle;
    try {
      lifecycle = readSubjectStateLifecycle(state.payload);
    } catch {
      continue;
    }

    if (
      !allowedKinds.has(state.kind)
      || !isConsolidationEligible(state.envelope.status)
      || lifecycle?.status === "archived"
      || !scopeApplies(state, input)
      || !state.text
    ) {
      continue;
    }

    if (
      nowMs !== null
      && lifecycle?.lastRecalledAt
      && nowMs - Date.parse(lifecycle.lastRecalledAt) < cooldownHours * 3_600_000
    ) {
      continue;
    }

    eligible.push({ state, lifecycle });
  }

  return eligible;
}

export function filterBreathEligibleStates(
  candidates: readonly SubjectStateWrite[],
  input: BreathEligibilityInput,
): SubjectStateWrite[] {
  return eligibleBreathEntries(candidates, input).map((entry) => entry.state);
}

function validatePolicy(input: {
  cooldownHours: number;
  salienceWeight: number;
  semanticWeight: number;
  semanticMinScore: number;
  now?: string;
}): number | null {
  parseCooldownNow(input.cooldownHours, input.now);
  if (
    !Number.isFinite(input.salienceWeight)
    || input.salienceWeight < 0
    || input.salienceWeight > 1
  ) {
    throw new Error("Breath salienceWeight must be between 0 and 1.");
  }
  if (
    !Number.isFinite(input.semanticWeight)
    || input.semanticWeight < 0
    || input.semanticWeight > 1
  ) {
    throw new Error("Breath semanticWeight must be between 0 and 1.");
  }
  if (
    !Number.isFinite(input.semanticMinScore)
    || input.semanticMinScore < 0
    || input.semanticMinScore > 1
  ) {
    throw new Error("Breath semanticMinScore must be between 0 and 1.");
  }
  return parseCooldownNow(input.cooldownHours, input.now);
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
    now?: string;
    cooldownHours?: number;
    salienceWeight?: number;
    semanticWeight?: number;
    semanticMinScore?: number;
    semanticScores?: ReadonlyMap<string, number>;
  },
): BreathRecallHit[] {
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error("Breath recall limit must be a positive integer.");
  }

  const cooldownHours = input.cooldownHours ?? 0;
  const salienceWeight = input.salienceWeight ?? 0;
  const semanticWeight = input.semanticWeight ?? 0;
  const semanticMinScore = input.semanticMinScore ?? 0;
  validatePolicy({
    cooldownHours,
    salienceWeight,
    semanticWeight,
    semanticMinScore,
    now: input.now,
  });

  const queryTokens = tokens(query);
  if (queryTokens.size === 0) return [];

  const hits: BreathRecallHit[] = [];
  const eligible = eligibleBreathEntries(candidates, {
    userId: input.userId,
    subjectId: input.subjectId,
    conversationId: input.conversationId,
    currentPathMessageIds: input.currentPathMessageIds,
    now: input.now,
    cooldownHours,
  });

  for (const { state, lifecycle } of eligible) {
    const candidateTokens = tokens(state.text!);
    if (candidateTokens.size === 0) continue;

    const matchedTokens = [...queryTokens].filter((token) =>
      candidateTokens.has(token),
    );
    const lexicalScore = breathLexicalScore(query, state.text!);

    const rawSemanticScore = input.semanticScores?.get(state.id);
    const semanticScore =
      typeof rawSemanticScore === "number"
      && Number.isFinite(rawSemanticScore)
      && rawSemanticScore >= 0
      && rawSemanticScore <= 1
        ? rawSemanticScore
        : null;

    const semanticEligible =
      semanticWeight > 0
      && semanticScore !== null
      && semanticScore >= semanticMinScore;
    if (lexicalScore <= 0 && !semanticEligible) continue;

    const lexicalWeight = 1 - semanticWeight;
    const baseScore =
      lexicalWeight * lexicalScore
      + semanticWeight * (semanticScore ?? 0);
    const salience = lifecycle?.salience ?? 1;
    const salienceFactor =
      (1 - salienceWeight) + salienceWeight * salience;
    const score = baseScore * salienceFactor;
    const channel =
      lexicalScore > 0 && semanticEligible
        ? "hybrid"
        : semanticEligible
          ? "semantic"
          : "lexical";

    hits.push({
      state,
      score,
      lexicalScore,
      semanticScore,
      salience,
      matchedTokens,
      channel,
    });
  }

  const ordered = hits.sort((left, right) =>
    right.score - left.score
    || right.lexicalScore - left.lexicalScore
    || left.state.id.localeCompare(right.state.id),
  );

  const deduped: BreathRecallHit[] = [];
  const seen = new Set<string>();
  for (const hit of ordered) {
    const key = dedupeKey(hit.state.text ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(hit);
    if (deduped.length >= input.limit) break;
  }

  return deduped;
}
