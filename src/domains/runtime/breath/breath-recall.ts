import type { SubjectStateKind, SubjectStateWrite } from "../subject-state/subject-state-contract.js";
import { isConsolidationEligible } from "../subject-state/runtime-status-axes.js";
import {
  readSubjectStateLifecycle,
  readSubjectStateRecallContext,
} from "../lifecycle/memory-lifecycle.js";

export const BREATH_RECALL_KINDS = ["memory"] as const satisfies readonly SubjectStateKind[];

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
  excludedStateIds?: ReadonlySet<string>;
  contextEpoch?: number;
  now?: string;
  cooldownHours?: number;
};

const ENGLISH_LOW_INFORMATION_TOKENS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by",
  "can", "could", "did", "do", "does", "doing", "for", "from", "had", "has",
  "have", "having", "he", "her", "here", "hers", "him", "his", "how", "i",
  "if", "in", "into", "is", "it", "its", "just", "know", "like", "maybe",
  "me", "mean", "my", "no", "not", "of", "oh", "okay", "on", "or", "our",
  "ours", "really", "say", "she", "so", "some", "sure", "tell", "than",
  "that", "the", "their", "them", "then", "there", "these", "they", "think",
  "this", "those", "to", "too", "us", "very", "want", "was", "we", "well",
  "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "yeah", "yes", "you", "your", "yours",
  "don't", "dont", "can't", "cant", "i'm", "im", "you're", "youre", "it's",
  "that's", "thats", "what's", "whats",
]);

const HAN_LOW_INFORMATION_BIGRAMS = new Set([
  "一个", "一些", "不是", "不过", "但是", "他们", "你们", "我们", "什么",
  "今天", "现在", "可以", "可能", "因为", "就是", "已经", "怎么", "所以",
  "昨天", "没有", "然后", "真的", "知道", "自己", "觉得", "这个", "那个",
  "还有", "这里", "那里", "时候",
]);

function tokens(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase().normalize("NFKC");
  const result = new Set<string>();

  for (const rawToken of normalized.match(/[a-z0-9_'-]+/g) ?? []) {
    const token = rawToken.replace(/^'+|'+$/g, "");
    if (
      token.length > 1
      && !ENGLISH_LOW_INFORMATION_TOKENS.has(token)
    ) {
      result.add(token);
    }
  }

  for (const sequence of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    const chars = Array.from(sequence);
    for (let index = 0; index + 1 < chars.length; index += 1) {
      const bigram = `${chars[index]}${chars[index + 1]}`;
      if (!HAN_LOW_INFORMATION_BIGRAMS.has(bigram)) {
        result.add(bigram);
      }
    }
    for (let index = 0; index + 2 < chars.length; index += 1) {
      result.add(
        `${chars[index]}${chars[index + 1]}${chars[index + 2]}`,
      );
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

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function effectiveSemanticFloor(
  scores: ReadonlyMap<string, number> | undefined,
  absoluteFloor: number,
  medianMargin: number,
): number {
  if (!scores || medianMargin <= 0) return absoluteFloor;
  const valid = [...scores.values()].filter(
    (score) =>
      Number.isFinite(score)
      && score >= 0
      && score <= 1,
  );
  if (valid.length < 8) return absoluteFloor;
  const baseline = median(valid);
  if (baseline === null) return absoluteFloor;
  return Math.min(
    0.98,
    Math.max(absoluteFloor, baseline + medianMargin),
  );
}

function semanticEvidence(
  score: number | null,
  floor: number,
): number {
  if (score === null || score <= floor || floor >= 1) return 0;
  return Math.min(1, (score - floor) / (1 - floor));
}

function readRecallContextSafely(
  payload: Record<string, unknown> | null | undefined,
) {
  try {
    return readSubjectStateRecallContext(payload);
  } catch {
    return null;
  }
}

function recallContextMatches(
  state: SubjectStateWrite,
  input: Pick<BreathEligibilityInput, "conversationId" | "contextEpoch">,
): boolean {
  if (input.contextEpoch === undefined) return false;
  const context = readRecallContextSafely(state.payload);
  return Boolean(
    context
    && context.conversationId === input.conversationId
    && context.epoch === input.contextEpoch,
  );
}

function recentRecallFactor(
  state: SubjectStateWrite,
  now: string | undefined,
  enabled: boolean,
  input: Pick<BreathEligibilityInput, "conversationId" | "contextEpoch">,
): number {
  if (!enabled || !now || !recallContextMatches(state, input)) return 1;
  const context = readRecallContextSafely(state.payload);
  if (!context) return 1;
  const nowMs = Date.parse(now);
  const recalledMs = Date.parse(context.recalledAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(recalledMs)) return 1;
  const ageHours = (nowMs - recalledMs) / 3_600_000;
  if (ageHours < 0) return 1;
  if (ageHours < 1) return 0.35;
  if (ageHours < 6) return 0.55;
  if (ageHours < 24) return 0.75;
  if (ageHours < 72) return 0.9;
  return 1;
}

function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
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
      || !scopeApplies(state, input)
      || input.excludedStateIds?.has(state.id)
      || !state.text
    ) {
      continue;
    }

    if (
      nowMs !== null
      && lifecycle?.lastRecalledAt
      && recallContextMatches(state, input)
      && nowMs - Date.parse(lifecycle.lastRecalledAt)
        < cooldownHours * 3_600_000
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
  minimumScore: number;
  semanticMedianMargin: number;
  diversityMaxTokenOverlap: number;
  now?: string;
}): number | null {
  parseCooldownNow(input.cooldownHours, input.now);
  for (const [label, value] of [
    ["salienceWeight", input.salienceWeight],
    ["semanticWeight", input.semanticWeight],
    ["semanticMinScore", input.semanticMinScore],
    ["minimumScore", input.minimumScore],
    ["semanticMedianMargin", input.semanticMedianMargin],
    ["diversityMaxTokenOverlap", input.diversityMaxTokenOverlap],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Breath ${label} must be between 0 and 1.`);
    }
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
    excludedStateIds?: ReadonlySet<string>;
    contextEpoch?: number;
    limit: number;
    now?: string;
    cooldownHours?: number;
    salienceWeight?: number;
    semanticWeight?: number;
    semanticMinScore?: number;
    semanticScores?: ReadonlyMap<string, number>;
    minimumScore?: number;
    semanticMedianMargin?: number;
    recentRecallPenalty?: boolean;
    diversityMaxTokenOverlap?: number;
  },
): BreathRecallHit[] {
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error("Breath recall limit must be a positive integer.");
  }

  const cooldownHours = input.cooldownHours ?? 0;
  const salienceWeight = input.salienceWeight ?? 0;
  const semanticWeight = input.semanticWeight ?? 0;
  const semanticMinScore = input.semanticMinScore ?? 0;
  const minimumScore = input.minimumScore ?? 0;
  const semanticMedianMargin = input.semanticMedianMargin ?? 0;
  const recentRecallPenalty = input.recentRecallPenalty ?? false;
  const diversityMaxTokenOverlap =
    input.diversityMaxTokenOverlap ?? 1;
  validatePolicy({
    cooldownHours,
    salienceWeight,
    semanticWeight,
    semanticMinScore,
    minimumScore,
    semanticMedianMargin,
    diversityMaxTokenOverlap,
    now: input.now,
  });

  const queryTokens = tokens(query);
  const hasSemanticChannel = Boolean(
    semanticWeight > 0
    && input.semanticScores
    && input.semanticScores.size > 0,
  );
  if (queryTokens.size === 0 && !hasSemanticChannel) return [];

  const hits: BreathRecallHit[] = [];
  const eligible = eligibleBreathEntries(candidates, {
    userId: input.userId,
    subjectId: input.subjectId,
    conversationId: input.conversationId,
    currentPathMessageIds: input.currentPathMessageIds,
    excludedStateIds: input.excludedStateIds,
    contextEpoch: input.contextEpoch,
    now: input.now,
    cooldownHours,
  });
  const eligibleStateIds = new Set(eligible.map(({ state }) => state.id));
  const eligibleSemanticScores = input.semanticScores
    ? new Map(
        [...input.semanticScores].filter(([stateId]) =>
          eligibleStateIds.has(stateId)
        ),
      )
    : undefined;
  const semanticFloor = effectiveSemanticFloor(
    eligibleSemanticScores,
    semanticMinScore,
    semanticMedianMargin,
  );

  for (const { state, lifecycle } of eligible) {
    const candidateTokens = tokens(state.text!);

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

    const candidateSemanticWeight =
      semanticScore === null ? 0 : semanticWeight;
    const semanticStrength =
      candidateSemanticWeight > 0
        ? semanticEvidence(semanticScore, semanticFloor)
        : 0;
    const semanticEligible = semanticStrength > 0;
    if (lexicalScore <= 0 && !semanticEligible) continue;

    const lexicalWeight = 1 - candidateSemanticWeight;
    const baseScore =
      lexicalWeight * lexicalScore
      + candidateSemanticWeight * semanticStrength;
    const salience = lifecycle?.salience ?? 1;
    const salienceFactor =
      (1 - salienceWeight) + salienceWeight * salience;
    const recallFactor = recentRecallFactor(
      state,
      input.now,
      recentRecallPenalty,
      {
        conversationId: input.conversationId,
        contextEpoch: input.contextEpoch,
      },
    );
    const score = baseScore * salienceFactor * recallFactor;
    if (score < minimumScore) continue;
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
    const text = hit.state.text ?? "";
    const key = dedupeKey(text);
    if (!key || seen.has(key)) continue;
    if (
      diversityMaxTokenOverlap < 1
      && deduped.some(
        (selected) =>
          tokenOverlap(selected.state.text ?? "", text)
          >= diversityMaxTokenOverlap,
      )
    ) {
      continue;
    }
    seen.add(key);
    deduped.push(hit);
    if (deduped.length >= input.limit) break;
  }

  return deduped;
}
