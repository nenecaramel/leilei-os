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
