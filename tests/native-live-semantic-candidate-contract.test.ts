import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NATIVE_LIVE_SEMANTIC_CANDIDATE_LIMIT } from "../src/shared/native-live-semantic-candidate-limit.js";
import { DEFAULT_MIND_LOOP_CONFIG } from "../src/domains/runtime/mind/default-backend-mind-runtime.js";

test("Mind scoring queue capacity preserves 256 candidates across config, schema and migrations", () => {
  assert.equal(NATIVE_LIVE_SEMANTIC_CANDIDATE_LIMIT, 256);
  assert.equal(DEFAULT_MIND_LOOP_CONFIG.breathSemanticCandidateLimit, NATIVE_LIVE_SEMANTIC_CANDIDATE_LIMIT);

  // No silent regression to the historical 64-item check in Drizzle metadata.
  const schema = readFileSync(
    new URL("../src/database/schema/native-live-semantic.ts", import.meta.url),
    "utf8",
  );
  assert.match(schema, /native_live_semantic_scoring_requests_candidates_array/);
  assert.match(schema, /BETWEEN 1 AND \$\{sql\.raw\(String\(NATIVE_LIVE_SEMANTIC_CANDIDATE_LIMIT\)\)\}/);

  // The repository read path must accept every snapshot the DB can persist.
  const scoringReader = readFileSync(
    new URL("../src/domains/bridge/mind/native-live-semantic-handshake.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    scoringReader,
    /value\.length > NATIVE_LIVE_SEMANTIC_CANDIDATE_LIMIT/,
  );
  assert.match(
    scoringReader,
    /import \{ NATIVE_LIVE_SEMANTIC_CANDIDATE_LIMIT \} from "\.\.\/\.\.\/\.\.\/shared\/native-live-semantic-candidate-limit\.js";/,
  );

  const migration = readFileSync(
    new URL("../drizzle/0108_native_live_semantic_candidates_256.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /DROP CONSTRAINT "native_live_semantic_scoring_requests_candidates_array"/);
  assert.match(migration, /ADD CONSTRAINT "native_live_semantic_scoring_requests_candidates_array"/);
  assert.match(migration, /jsonb_array_length\("candidates"\) BETWEEN 1 AND 256/);
  assert.doesNotMatch(migration, /\b(?:DELETE|TRUNCATE|DROP TABLE|UPDATE)\b/i);

  const journal = JSON.parse(
    readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  assert.deepEqual(journal.entries.slice(-2).map(({ idx, tag }) => ({ idx, tag })), [
    { idx: 107, tag: "0107_native_session_preservation" },
    { idx: 108, tag: "0108_native_live_semantic_candidates_256" },
  ]);
});
