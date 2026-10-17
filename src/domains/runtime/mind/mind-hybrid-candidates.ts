/**
 * EXPERIMENTAL offline E5+ritrieve candidate fusion. No production routing.
 *
 * Keep E5's high-recall ranking as a source of candidates; require independent
 * local ritrieve agreement before selecting. A lower-confidence rescue path is
 * permitted only with a literal 3-character anchor in the memory text.
 *
 * All decisions are deterministic and bounded; do not describe this as a
 * calibrated precision/recall threshold until user-labelled validation.
 */
export type HybridScore = {stateId: string; score: number};
export type HybridMemory = {stateId: string; text: string};
export type HybridMode = "agreement" | "anchored_rescue";

export type HybridInput = {
  query: string;
  memories: readonly HybridMemory[];
  e5Ranked: readonly HybridScore[];
  ritrieveRanked: readonly HybridScore[];
  mode: HybridMode;
  maxItems?: number;
};

/** A contiguous literal phrase, not simply two semantically related topics. */
export function hasDirectPhraseAnchor(query: string, text: string): boolean {
  const clean = (value: string) => value.normalize("NFC")
    .toLocaleLowerCase("en").replace(/[\s\p{P}\p{S}]+/gu, "");
  const q = clean(query);
  const t = clean(text);
  if (q.length < 3 || t.length < 3) return false;
  for (let i = 0; i + 3 <= q.length; i++) {
    const fragment = q.slice(i,i+3);
    // Require at least one Chinese ideograph: trivial English short trigrams
    // and common punctuation never act as a rescue permission.
    if (/[\p{Script=Han}]/u.test(fragment) && t.includes(fragment)) return true;
  }
  return false;
}

export function selectHybridMindCandidates(input: HybridInput): HybridScore[] {
  const {query, memories, e5Ranked, ritrieveRanked, mode} = input;
  const limit = input.maxItems ?? 4;
  if (!Number.isInteger(limit) || limit < 1 || limit > 4
      || (mode !== "agreement" && mode !== "anchored_rescue")
      || query.trim().length === 0) return [];
  const textById = new Map(memories.map(memory => [memory.stateId, memory.text]));
  const e5 = new Map(e5Ranked.map((hit, rank) => [hit.stateId, {...hit, rank}]));
  const rit = new Map(ritrieveRanked.map((hit, rank) => [hit.stateId, {...hit, rank}]));
  const eligible: Array<{stateId: string; score: number}> = [];
  for (const [id, old] of e5) {
    const next = rit.get(id);
    const text = textById.get(id);
    if (text === undefined || !next || !Number.isFinite(old.score)
      || !Number.isFinite(next.score) || old.score < 0.80) continue;
    // Strict mutual top-ranked support path. A single model cannot authorize
    // recall, no matter how confident its isolated score seems.
    const agreed = old.rank < 6 && next.rank < 12 && next.score >= 0.68;
    // Lower-score rescue only where BOTH models still consider this a
    // candidate, and the user's wording literally occurs in the memory.
    const rescue = mode === "anchored_rescue"
      && old.rank < 4 && next.rank < 48 && next.score >= 0.58
      && hasDirectPhraseAnchor(query, text);
    if (!agreed && !rescue) continue;
    // Reciprocal-rank fusion, with E5 slightly favored to limit missed positives.
    const combined = 0.6 / (old.rank + 1) + 0.4 / (next.rank + 1);
    eligible.push({stateId:id, score:combined});
  }
  eligible.sort((a,b)=>b.score-a.score || a.stateId.localeCompare(b.stateId));
  return eligible.slice(0,limit);
}
