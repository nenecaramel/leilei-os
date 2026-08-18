import assert from "node:assert/strict";
import test from "node:test";
import {
  UNSAVED_CHANGES_MESSAGE,
  confirmUnsavedChanges,
  createMutationOwnership,
  createSubmissionGate,
} from "../web/src/pages/submission-gate.js";

test("Task submission gate rejects duplicate work until the request settles", () => {
  const gate = createSubmissionGate();
  assert.equal(gate.enter(), true);
  assert.equal(gate.enter(), false);
  gate.leave();
  assert.equal(gate.enter(), true);
});

test("shared mutation gate blocks conflicting writes and releases after failure", () => {
  const gate = createSubmissionGate();
  assert.equal(gate.enter(), true, "create acquires synchronously");
  assert.equal(gate.enter(), false, "update/status/archive cannot overlap");
  gate.leave();
  assert.equal(gate.enter(), true, "an explicit retry can start after failure");
  gate.leave();
  assert.equal(gate.enter(), true, "confirmation cancellation releases the gate");
});

test("mutation ownership rejects stale completions after context changes", () => {
  const ownership = createMutationOwnership();
  const first = ownership.begin();
  assert.equal(ownership.owns(first), true);
  ownership.invalidate();
  assert.equal(ownership.owns(first), false);
  const retry = ownership.begin();
  assert.equal(ownership.owns(retry), true);
  assert.equal(ownership.owns(first), false);
});

test("dirty-form confirmation uses the exact product copy", () => {
  const messages: string[] = [];
  assert.equal(confirmUnsavedChanges(false, () => false), true);
  assert.equal(confirmUnsavedChanges(true, (message) => {
    messages.push(message);
    return false;
  }), false);
  assert.deepEqual(messages, [UNSAVED_CHANGES_MESSAGE]);
  assert.equal(UNSAVED_CHANGES_MESSAGE, "当前有未保存的内容，确定要离开吗？");
});
