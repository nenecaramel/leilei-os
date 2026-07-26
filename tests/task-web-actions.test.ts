import assert from "node:assert/strict";
import test from "node:test";
import { getTaskActionControls } from "../web/src/pages/task-actions.js";

test("Task UI only renders controls supplied by the domain action payload", () => {
  assert.deepEqual(getTaskActionControls(["start", "cancel"]), ["start", "cancel"]);
  assert.deepEqual(getTaskActionControls(["complete", "cancel"]), ["complete", "cancel"]);
  assert.deepEqual(getTaskActionControls([]), []);
});
