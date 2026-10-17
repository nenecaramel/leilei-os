/**
 * Mac-only isolated staging E2E: use the locally installed ritrieve model
 * against synthetic fixtures in the separate Railway staging project.
 * No production credentials, native daemon, Hook settings, or actual Mind data.
 *
 * Run:
 *   read -s LEILEI_MIND_STAGING_TOKEN
 *   LEILEI_MIND_STAGING_TOKEN="$LEILEI_MIND_STAGING_TOKEN" pnpm exec tsx scripts/mind-ritrieve-staging-e2e.ts
 *   unset LEILEI_MIND_STAGING_TOKEN
 *
 * Never paste or commit the staging token.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { LocalRitrieveBreathSemanticScorer } from "../src/domains/runtime/breath/local-ritrieve-embedding.js";
import { MacMindSnapshotSync } from "../src/domains/bridge/mac/native-live-mac-mind-snapshot-sync.js";

const STAGING_URL = "https://leilei-mind-api-staging-staging.up.railway.app";
const VISIBLE_BAKING = "11111111-1111-4111-8111-111111111111";
const VISIBLE_PROMISE = "22222222-2222-4222-8222-222222222222";
const HIDDEN = "33333333-3333-4333-8333-333333333333";
const token = process.env.LEILEI_MIND_STAGING_TOKEN;
if (!token || token.length < 32) {
  throw new Error("Staging relay token is required; read it privately from the staging Railway service.");
}
const scorer = new LocalRitrieveBreathSemanticScorer();
const checks = [
  {tag: "promise", query: "我还是在意以前答应过的事", expected: VISIBLE_PROMISE},
  {tag: "baking", query: "怎么让面包发得更好", expected: VISIBLE_BAKING},
  {tag: "unrelated", query: "太阳系里有哪些行星", expected: null},
] as const;

try {
  const first = performance.now();
  await scorer.warmup();
  const warmedMs = Math.round(performance.now() - first);
  const indexStarted = performance.now();
  await new MacMindSnapshotSync(STAGING_URL, token, scorer).refresh();
  const indexedMs = Math.round(performance.now() - indexStarted);
  assert.equal(scorer.isSnapshotReady(), true);

  const output: Array<Record<string, unknown>> = [];
  const failedCases: string[] = [];
  for (const c of checks) {
    const queryStarted = performance.now();
    const result = await scorer.searchSnapshot(c.query, 48);
    const queryMs = Math.round(performance.now() - queryStarted);
    assert.equal(result.count, 2, "Only two visible synthetic memories may enter the index.");
    assert.equal(result.version.length, 64);
    assert.ok(result.hits.every(hit => hit.stateId !== HIDDEN), "Hidden fixture was indexed.");

    // Reproduce the actual indexed Hook safety filter. Search returns all
    // scored hits; the Hook sends only hits that clear this relevance floor.
    const floor = Math.max(0.68, result.floor ?? 0.68);
    const eligibleHits = result.hits.filter(hit => hit.score >= floor).slice(0, 48);
    const localTopMatchesLabel = c.expected
      ? eligibleHits[0]?.stateId === c.expected
      : null;

    const responseStarted = performance.now();
    const response: Response = await fetch(`${STAGING_URL}/internal/mind/recall`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({
        session_id: "mind-ritrieve-mac-staging-e2e",
        query: c.query, exclude_ids: [],
        caller: "claude_code", context_epoch: 0,
        receipt_mode: "signed_v1",
        semantic_snapshot_version: result.version,
        snapshot_scores: Object.fromEntries(eligibleHits.map(hit => [hit.stateId, hit.score])), 
      }),
    });
    const railwayMs = Math.round(performance.now() - responseStarted);
    assert.equal(response.status, 200, "Staging recall must succeed with staging-only credentials.");
    const envelope: unknown = await response.json();
    assert.ok(envelope && typeof envelope === "object" && "success" in envelope &&
      envelope.success === true && "data" in envelope);
    const data = envelope.data as Record<string, unknown>;
    assert.ok(Array.isArray(data.memory_ids));
    assert.equal(data.semantic_mode, "snapshot_v1", "Railway must verify the current snapshot.");
    const selectedIds = data.memory_ids as string[];
    assert.ok(selectedIds.every(id => id !== HIDDEN), "Hidden fixture was recalled.");
    if (eligibleHits.length === 0) {
      assert.equal(selectedIds.length, 0);
      assert.equal(data.context, "");
    }
    const railwayMatchesLabel = c.expected ? selectedIds.includes(c.expected) : null;
    const negativeEmpty = c.expected === null ? selectedIds.length === 0 : null;
    const passed = c.expected
      ? localTopMatchesLabel === true && railwayMatchesLabel === true
      : negativeEmpty === true;
    if (!passed) failedCases.push(c.tag);
    output.push({
      query_type: c.tag,
      passed,
      relevance_floor: floor,
      local_raw_hits: result.hits.length,
      local_hits: eligibleHits.length,
      local_top_matches_label: localTopMatchesLabel,
      railway_matches_label: railwayMatchesLabel,
      negative_empty: negativeEmpty,
      local_query_ms: queryMs,
      railway_recall_ms: railwayMs,
    });
  }
  const allPassed = failedCases.length === 0;
  console.log(JSON.stringify({
    stage: "synthetic_mac_model_to_railway_verified_recall",
    result: allPassed ? "PASS" : "FAIL",
    failed_cases: failedCases,
    warmup_ms: warmedMs,
    snapshot_index_ms: indexedMs,
    indexed_visible_memory_count: 2,
    hidden_memory_excluded: true,
    checks: output,
    note: "Synthetic-only integration. Positive/negative quality metrics are observations, not quality certification.",
  }, null, 2));
  if (!allPassed) process.exitCode = 1;
} catch (error) {
  // Avoid printing prompt, model response, or credentials in terminal logs.
  const name = error instanceof Error && /^[A-Za-z0-9_.-]{1,64}$/.test(error.name)
    ? error.name : "UNKNOWN";
  console.error(`Staging Mac E2E failed: ${name}`);
  process.exitCode = 1;
} finally {
  await scorer.close();
}
