import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The October 17-18 incident's detailed SQL diagnostic existed solely to
// identify a production 409. It must not keep running an expensive duplicate
// read on every failed recovery attempt or disclose live session metadata.
const source = readFileSync(
  "src/domains/bridge/relay/native-live-background-result-repository.ts",
  "utf8",
);

test("Wake recovery removes incident-only diagnostic reads and verbose retry logs", () => {
  for (const marker of [
    "native_background_recovery_evidence",
    "native_background_snapshot_missing",
    "native_background_renewal_hash_conflict",
    "native_background_renewal_rejected",
    "native_background_fresh_snapshot_rejected",
    '"wakeSourceVerifiedLineage"',
  ]) {
    assert.equal(source.includes(marker), false, `retire ${marker}`);
  }
  assert.doesNotMatch(source, /process\.stderr\.write/u);
});

test("historical Wake recovery keeps the strict receipt, writer, and ancestry barriers", () => {
  assert.match(source, /const verifiedWakeSourceLineage = sql`/u);
  assert.match(source, /wake_message\.parent_message_id::text=wake\.wake_context->>'source_head_message_id'/u);
  assert.match(source, /chain\.depth<128 AND NOT parent\.id=ANY\(chain\.visited\)/u);
  assert.match(source, /AND \$\{verifiedWakeSourceLineage\}/u);
  assert.match(source, /rejected\.dispatch_error_code='INVALID_COMMAND'/u);
  assert.match(source, /rejected\.result_hash IS NULL AND rejected\.assistant_message_id IS NULL/u);
  assert.match(source, /rejected_event\.prepare_id=rejected\.id/u);
  assert.match(source, /rejected_user\.parent_message_id=c\.current_head_message_id/u);
  assert.match(source, /lease_expires_at>clock_timestamp\(\) FOR SHARE/u);
  assert.match(source, /if \(repaired && \(!row \|\| !isDeepStrictEqual\(row, knownReceipt\)\)\) throw conflict\(\);/u);
});

test("historical result replay stays idempotent and does not invoke a model", () => {
  assert.match(source, /readDurableBackgroundReceipt\(tx, userId, identity\)/u);
  assert.match(source, /if \(!isDeepStrictEqual\(durable\.identity, identity\) \|\| durable\.resultHash !== resultHash\) throw conflict\(\);/u);
  assert.match(source, /if \(!live \|\| !isDeepStrictEqual\(live, existing\.context\)\) throw conflict\(\);/u);
});
