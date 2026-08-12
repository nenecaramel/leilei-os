import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatTodoStorageDate } from "../web/src/pages/todo-paper-storage.js";

const source = readFileSync(new URL("../web/src/pages/DashboardPage.tsx", import.meta.url), "utf8");

test("Todo business dates use the device-local calendar date", () => {
  assert.equal(formatTodoStorageDate(new Date(2026, 1, 28, 23, 59)), "2026-02-28");
  assert.equal(formatTodoStorageDate(new Date(2024, 1, 29, 12, 0)), "2024-02-29");
});

test("Home checks foreground events and defers rollover while a paper is dirty", () => {
  assert.match(source, /addEventListener\("focus"/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /if \(dialogDirty\) setPendingDate/);
  assert.match(source, /setDateKey\(nextDate\)/);
});
