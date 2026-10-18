/**
 * LOCAL ONLY: Compare the actual opt-in conditional-two live scorer against
 * the existing on-device fixed human reviews (8 + 12 questions) using the *on-demand* candidate scorer.
 *
 * No HTTP, Railway, daemon, Hook, DB, log files or Memory writes.
 * Private backup/query/labels are read solely in this process on the user's Mac.
 * Only anonymous aggregate metrics are printed. It verifies the original
 * SHA256 fingerprint and reuses the exact historic 20..256-memory sample,
 * even if the current backup contains more than 256 eligible records.
 * This does NOT test the new Railway SQL full-library candidate stage.
 *
 * Usage:
 *   pnpm exec tsx scripts/mind-hybrid2-local-smoke.ts \
 *     "$HOME/Downloads/leileios-full-backup_XXX.json" \
 *     "$HOME/.leileios/mind-eval/fixed-review.json" \
 *     "$HOME/.leileios/mind-eval/fixed-review-round2.json"
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { snapshotMemories } from "../src/domains/runtime/mind/mind-snapshot-version.js";
import { LocalHybridMindRecallScorer } from "../src/domains/runtime/mind/local-hybrid-mind-recall.js";
import type { SubjectStateWrite } from "../src/domains/runtime/subject-state/subject-state-contract.js";

type ObjectLike = Record<string, unknown>;
type CorpusMemory = {stateId: string; text: string};
type HumanCase = {query: string; labeled: boolean; judged_ids: string[]; relevant_ids: string[]};
const object = (v: unknown): v is ObjectLike => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const sha = (v: string): string => createHash("sha256").update(v).digest("hex");
const uuid = (v: unknown): v is string => text(v) && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const percentile = (a: number[], fraction: number) => {
  const sorted = [...a].sort((x, y) => x - y);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};

function loadCorpus(value: unknown): CorpusMemory[] {
  if (!object(value) || value.schema_version !== 4 || !object(value.data)
      || !Array.isArray(value.data.mind))
    throw new Error("INVALID_BACKUP");
  const states: SubjectStateWrite[] = [];
  for (const row of value.data.mind) {
    if (!object(row) || row.kind !== "memory" || row.subject_id !== "G"
        || !uuid(row.id) || !text(row.text) || !object(row.envelope)
        || !object(row.envelope.scope) || !object(row.envelope.status)) continue;
    states.push({id: row.id, kind: "memory", text: row.text,
      envelope: row.envelope as unknown as SubjectStateWrite["envelope"]});
  }
  const result = snapshotMemories(states)
    .map(m => ({stateId: m.stateId, text: m.text}))
    // Match the exact corpus ordering/fingerprint of mind-real-blind-review.ts
    .sort((a, b) => sha(a.stateId).localeCompare(sha(b.stateId)));
  if (result.length === 0) throw new Error("CORPUS_UNAVAILABLE");
  return result;
}

function loadReview(value: unknown, fingerprint: string, known: Set<string>): HumanCase[] {
  if (!object(value) || value.schema_version !== 1
      || value.corpus_fingerprint !== fingerprint || !Array.isArray(value.cases)
      || value.cases.length === 0 || value.cases.length > 24)
    throw new Error("PRIVATE_REVIEW_MISMATCH");
  const cases: HumanCase[] = [];
  for (const c of value.cases) {
    if (!object(c) || !text(c.query) || !c.query.trim() || c.labeled !== true
        || !Array.isArray(c.judged_ids) || !Array.isArray(c.relevant_ids))
      throw new Error("INVALID_PRIVATE_LABEL");
    // Assign after narrowing object properties: TypeScript cannot preserve
    // narrowing of c.judged_ids across a nested array callback.
    const judgedIds: unknown[] = c.judged_ids;
    const relevantIds: unknown[] = c.relevant_ids;
    if (!judgedIds.every(id => text(id) && known.has(id))
        || !relevantIds.every(id => text(id) && judgedIds.includes(id))
        || new Set(judgedIds).size !== judgedIds.length
        || new Set(relevantIds).size !== relevantIds.length)
      throw new Error("INVALID_PRIVATE_LABEL");
    cases.push({query: c.query, labeled: true,
      judged_ids: judgedIds as string[], relevant_ids: relevantIds as string[]});
  }
  return cases;
}

async function main() {
  const [backupPath, ...reviewPaths] = process.argv.slice(2);
  if (!backupPath || reviewPaths.length !== 2 || reviewPaths.some(p => !p))
    throw new Error("ARGS_REQUIRE_BACKUP_AND_TWO_PRIVATE_REVIEW_FILES");
  const allEligible = loadCorpus(JSON.parse(await readFile(backupPath, "utf8")));
  // The historic human review used a deterministic SHA256(ID) ordered prefix
  // with --limit=20..256, not necessarily the entire exported Memory library.
  // Find the original sampled corpus by its exact ID+text fingerprint. Never
  // silently attach old human labels to newly edited/added memory content.
  const rawReviews: unknown[] = [];
  for (const path of reviewPaths) rawReviews.push(JSON.parse(await readFile(path, "utf8")));
  const reviewFingerprints = rawReviews.map(r =>
    object(r) && text(r.corpus_fingerprint) ? r.corpus_fingerprint : "");
  if (!reviewFingerprints[0] || reviewFingerprints[0] !== reviewFingerprints[1])
    throw new Error("PRIVATE_REVIEW_FINGERPRINT_MISMATCH");
  const sampledLength = Array.from(
    {length:Math.min(256,allEligible.length)-Math.min(20,allEligible.length)+1},
    (_,i)=>Math.min(20,allEligible.length)+i,
  ).find(length =>
    sha(JSON.stringify(allEligible.slice(0,length).map(m=>[m.stateId,m.text])))
      === reviewFingerprints[0]);
  if (!sampledLength) throw new Error("PRIVATE_REVIEW_CORPUS_MISMATCH");
  const memory = allEligible.slice(0,sampledLength);
  const known = new Set(memory.map(m => m.stateId));
  const reviews = rawReviews.map(r=>loadReview(r,reviewFingerprints[0]!,known));
  const scorer = new LocalHybridMindRecallScorer();
  try {
    const started = performance.now();
    await scorer.warmup();
    const warmupMs = performance.now() - started;
    // Exercise the new on-demand path, not the retired full-snapshot scorer.
    const candidates = memory.map(m => ({
      stateId:m.stateId, text:m.text, kind:"memory" as const,
    }));
    const reports = [];
    const allLatencies: number[] = [];
    for (let batch = 0; batch < reviews.length; batch++) {
      let positives = 0, hitQueries = 0, relevantReturn = 0, relevantInUnion = 0;
      let negative = 0, negativeEmpty = 0, wrong = 0, totalReturn = 0;
      let unlabeledSelections = 0, maxReturned = 0;
      const latencies: number[] = [];
      for (const c of reviews[batch]!) {
        const begin = performance.now();
        const result = await scorer.scoreCandidatesHybrid({query:c.query,candidates});
        const elapsed = performance.now() - begin;
        latencies.push(elapsed);
        allLatencies.push(elapsed);
        if (result.selectedIds.length > 2 ||
            new Set(result.selectedIds).size !== result.selectedIds.length ||
            result.selectedIds.some(id=>!known.has(id)))
          throw new Error("LIVE_SELECTOR_CONTRACT");
        const selected = result.selectedIds;
        const relevant = new Set(c.relevant_ids);
        const judged = new Set(c.judged_ids);
        const matches = selected.filter(id => relevant.has(id)).length;
        const unjudged = selected.filter(id=>!judged.has(id)).length;
        const judgedWrong = selected.filter(id=>judged.has(id) && !relevant.has(id)).length;
        unlabeledSelections += unjudged;
        totalReturn += selected.length;
        wrong += judgedWrong;
        relevantReturn += matches;
        maxReturned = Math.max(maxReturned, selected.length);
        if (relevant.size > 0) {
          positives++;
          relevantInUnion += relevant.size;
          if (matches > 0) hitQueries++;
        } else {
          negative++;
          if (selected.length === 0) negativeEmpty++;
        }
      }
      reports.push({
        group: batch === 0 ? "fixed_8" : "fixed_12",
        reviewed_queries: reviews[batch]!.length,
        positive_query_hits: hitQueries, positive_queries: positives,
        relevant_memories_returned: relevantReturn,
        relevant_memories_in_reviewed_union: relevantInUnion,
        negative_empty: negativeEmpty, negative_queries: negative,
        wrong_memories_returned: wrong, total_memories_returned: totalReturn,
        unlabeled_selections: unlabeledSelections,
        max_memories_per_query: maxReturned,
        local_query_p50_ms: Math.round(percentile(latencies, 0.50)),
        local_query_p95_ms: Math.round(percentile(latencies, 0.95)),
        local_query_max_ms: Math.round(Math.max(...latencies)),
      });
    }
    // Report aggregate only. No query, Memory, ID, token or path is printed.
    console.log(JSON.stringify({
      experiment: "local_on_demand_conditional_two_selector_against_private_fixed_reviews",
      model: "E5_plus_ritrieve",
      eligible_memory_total: allEligible.length,
      reviewed_corpus_memory_count: memory.length,
      scope: "Previously fixed, SHA-verified blind-review subset; tests local dual-model scorer only, not Railway SQL candidate discovery.",
      model_warmup_ms: Math.round(warmupMs),
      candidate_count_per_query: candidates.length,
      queries: allLatencies.length,
      local_query_p50_ms: Math.round(percentile(allLatencies, 0.50)),
      local_query_p95_ms: Math.round(percentile(allLatencies, 0.95)),
      local_query_max_ms: Math.round(Math.max(...allLatencies)),
      local_p95_under_hook_1000ms_budget: percentile(allLatencies, 0.95) < 1000,
      groups: reports,
      limitations: "On-device fixed-review subset only: no Railway SQL candidate discovery, no installed Hook/socket/network authorization, and not all Memory. Wrong-return count includes judged-wrong selections only; unjudged selections reported separately and require human review. A no-positive-in-union case is not necessarily a globally negative question.",
    }, null, 2));
    if (reports.some(r => r.unlabeled_selections > 0)) process.exitCode = 2;
  } finally {
    await scorer.close();
  }
}

try { await main(); }
catch (error) {
  const code = error instanceof Error && /^[A-Z_]{3,64}$/.test(error.message)
    ? error.message : "LOCAL_VALIDATION_FAILED";
  console.error("Hybrid2 local validation failed:", code);
  process.exitCode = 1;
}
