import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUNTIME_OPERATIONAL_RETENTION_DAYS,
  RUNTIME_OPERATIONAL_RETENTION_SPEC,
} from "../src/domains/retention/runtime-operational-retention.js";

const source = readFileSync(
  new URL(
    "../src/domains/retention/runtime-operational-retention.ts",
    import.meta.url,
  ),
  "utf8",
);

const schemaSource = readFileSync(
  new URL(
    "../src/database/schema.ts",
    import.meta.url,
  ),
  "utf8",
);

test("runtime operational retention declares a bounded TTL", () => {
  assert.equal(RUNTIME_OPERATIONAL_RETENTION_DAYS, 30);
  assert.deepEqual(RUNTIME_OPERATIONAL_RETENTION_SPEC, {
    dataClass: "operational",
    retentionMode: "ttl",
    ttlMs: 30 * 24 * 60 * 60 * 1_000,
  });
});

test("runtime retention deletes only reconciled terminal effect rows", () => {
  assert.match(source, /status = 'observed'/);
  assert.match(
    source,
    /status = 'failed' AND retryable = false/,
  );
  assert.doesNotMatch(
    source,
    /status = 'unknown'[\s\S]*DELETE FROM runtime_effects/,
  );
});

test("turn preparation retention preserves unresolved follow-up and semantic work", () => {
  assert.match(
    source,
    /followup\.status IN \('pending', 'processing'\)/,
  );
  assert.doesNotMatch(
    source,
    /followup\.status IN \('pending', 'processing', 'quarantined'\)/,
  );
  assert.match(
    source,
    /scoring\.status IN \('pending', 'reserved'\)/,
  );
  assert.match(
    source,
    /preparation\.dispatch_status = 'rejected'/,
  );
  assert.match(
    source,
    /preparation\.status IN \([\s\S]*'finalized_success',[\s\S]*'finalized_failure'/,
  );
});

test("context manifests and stale listener leases are bounded operational data", () => {
  assert.match(source, /DELETE FROM runtime_context_manifests/);
  assert.match(
    source,
    /DELETE FROM native_live_runtime_listener_leases/,
  );
  assert.match(source, /DELETE FROM bridge_listener_leases/);
});


test("foreground runtime event, interaction and control records inherit the bounded turn TTL by cascade", () => {
  for (const foreignKeyName of [
    "native_live_runtime_events_preparation_user_fk",
    "native_live_runtime_interactions_preparation_user_fk",
    "native_live_runtime_controls_preparation_user_fk",
  ]) {
    const marker = 'name: "' + foreignKeyName + '"';
    const start = schemaSource.indexOf(marker);
    assert.notEqual(start, -1);
    const foreignKeyBlock = schemaSource.slice(start, start + 180);
    assert.match(
      foreignKeyBlock,
      /\.onDelete\("cascade"\)/u,
    );
  }
});


test("Mind semantic grouping retention removes only terminal scoring requests", () => {
  assert.match(
    source,
    /FROM runtime_mind_semantic_grouping_requests[\s\S]*status IN \('completed', 'fallback'\)/,
  );
  assert.doesNotMatch(
    source,
    /runtime_mind_semantic_grouping_requests[\s\S]{0,300}status IN \('pending', 'reserved'\)[\s\S]{0,300}DELETE FROM runtime_mind_semantic_grouping_requests/,
  );
});
