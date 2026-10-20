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

// SQL behavior is exercised by the isolated PostgreSQL receipt/line-generation
// regressions. Here only guard removal of the retired incident-repair wiring.
test("generation readers retire the rejected-slot repair and keep live lease locking", () => {
  assert.doesNotMatch(source, /reconcileRejectedWakePresentationOwner|verifiedWakeSourceLineage/u);
  assert.match(source, /JOIN native_live_session_owners o/u);
  assert.match(source, /lease_expires_at>clock_timestamp\(\) FOR SHARE/u);
});

test("historical result replay stays idempotent and does not invoke a model", () => {
  assert.match(source, /readDurableBackgroundReceipt\(tx, userId, identity\)/u);
  assert.match(source, /if \(!isDeepStrictEqual\(durable\.identity, identity\) \|\| durable\.resultHash !== resultHash\) throw conflict\(\);/u);
  assert.match(source, /if \(!live \|\| !sameNativeSnapshot\(live, existing\.context\)\) throw conflict\(\);/u);
});
