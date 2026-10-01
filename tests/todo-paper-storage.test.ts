import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTodoPaperDate,
  formatTodoStorageDate,
} from "../web/src/pages/todo-paper-storage.js";

test("Todo paper dates use local YYYY-MM-DD keys and YYYY.MM.DD labels", () => {
  const date = new Date(2026, 7, 7, 12, 0, 0);
  assert.equal(formatTodoStorageDate(date), "2026-08-07");
  assert.equal(formatTodoPaperDate(date), "2026.08.07");
});
