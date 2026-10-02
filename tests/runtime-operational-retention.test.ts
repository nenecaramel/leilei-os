import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  RUNTIME_OPERATIONAL_RETENTION_DAYS,
  RUNTIME_OPERATIONAL_RETENTION_SPEC,
} from "../src/domains/retention/runtime-operational-retention.js";
import { readSchemaSource } from "./helpers/schema-source.js";

const source = readFileSync(
  new URL(
    "../src/domains/retention/runtime-operational-retention.ts",
    import.meta.url,
  ),
  "utf8",
);

const schemaSource = readSchemaSource();

const processRuntimeSource = readFileSync(
  new URL(
    "../src/app/process-runtime.ts",
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

test("context manifests and current runtime listener leases are bounded operational data", () => {
  assert.match(source, /DELETE FROM runtime_context_manifests/);
  assert.match(
    source,
    /DELETE FROM native_live_runtime_listener_leases/,
  );
  assert.doesNotMatch(source, /bridge_listener_leases/);
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


test("cloud runtime owns bounded retention while awake and catches up on start", () => {
  const start = processRuntimeSource.indexOf("startBackgroundWork: () => {");
  const stop = processRuntimeSource.indexOf(
    "stopBackgroundWork: () => {",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(stop, -1);
  const startupBlock = processRuntimeSource.slice(start, stop);

  assert.match(startupBlock, /retentionCoordinator\.start\(\)/u);
  assert.match(
    startupBlock,
    /operationalRetention:\s*"startup_then_while_process_awake"/u,
  );
  assert.doesNotMatch(
    startupBlock,
    /retentionCoordinator\.runNow\(\)/u,
  );
  assert.match(
    processRuntimeSource,
    /intervalMs:\s*governance\.idempotencyCleanupIntervalHours\s*\*\s*60\s*\*\s*60\s*\*\s*1_000/u,
  );
  assert.match(
    processRuntimeSource,
    /stopBackgroundWork:[\s\S]*retentionCoordinator\.stopScheduling\(\)/u,
  );
});
