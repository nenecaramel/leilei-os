import assert from "node:assert/strict";
import test from "node:test";
import { canonicalize, hashCanonical } from "../src/domains/import/import-canonical.js";

test("canonicalize preserves booleans and still rejects non-finite numbers", () => {
  assert.equal(canonicalize({ archived: false, enabled: true }), '{"archived":false,"enabled":true}');
  assert.match(hashCanonical({ archived: false }), /^[0-9a-f]{64}$/u);
  assert.throws(() => canonicalize({ value: Number.NaN }), /unsupported canonical value/);
});
