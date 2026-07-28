import assert from "node:assert/strict";
import test from "node:test";
import { createSubmissionGate } from "../web/src/pages/submission-gate.js";

test("Task submission gate rejects duplicate work until the request settles", () => {
  const gate = createSubmissionGate();
  assert.equal(gate.enter(), true);
  assert.equal(gate.enter(), false);
  gate.leave();
  assert.equal(gate.enter(), true);
});
