import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRows, withText, splitTodoText, splitPastedTodoLines, planTodoPaste, mergeTodoRows, type EditableTodoRow } from "../web/src/pages/todo-row-transforms.js";
const first: EditableTodoRow = { id: "l-existing", kind: "completed", text: "Alpha" };
const second: EditableTodoRow = { id: "l-second", kind: "record", text: "Beta" };
test("Normalization trims and removes empty rows without changing IDs/kinds/order", () => {
  const input = [first, { ...second, text: "  Beta  " }, { id: "empty", kind: "pending" as const, text: "\n  ", creation: true }];
  assert.deepEqual(normalizeRows(input), [first, second]);
  assert.equal(input[1].text, "  Beta  ");
  assert.deepEqual(normalizeRows([]), []);
});
test("Text updates keep status and identity while preserving creation semantics", () => {
  assert.deepEqual(withText({ ...first, creation: true }, " value "), { ...first, text: " value ", creation: undefined });
  assert.equal(withText(first, "  ").creation, true);
  assert.equal(withText({ ...first, creation: false }, "").creation, false);
  assert.equal(first.text, "Alpha");
});
test("Split preserves text order and removes only the selected range", () => {
  assert.deepEqual(splitTodoText("AlphaBeta", 5, 5), { before: "Alpha", after: "Beta" });
  assert.deepEqual(splitTodoText("AlphaXXBeta", 5, 7), { before: "Alpha", after: "Beta" });
});
test("Split handles empty/start/end and UTF-16 textarea selection offsets", () => {
  assert.deepEqual(splitTodoText("", 0, 0), { before: "", after: "" });
  assert.deepEqual(splitTodoText("Alpha", 0, 0), { before: "", after: "Alpha" });
  assert.deepEqual(splitTodoText("Alpha", 5, 5), { before: "Alpha", after: "" });
  assert.deepEqual(splitTodoText("😀a", 2, 2), { before: "😀", after: "a" });
});
test("Paste normalizes CRLF/CR and preserves blank and trailing lines", () => {
  assert.deepEqual(splitPastedTodoLines("A\r\n\rB\n"), ["A", "", "B", ""]);
  assert.deepEqual(splitPastedTodoLines(""), [""]);
});
test("Paste keeps prefix/suffix and caret before preserved suffix", () => {
  assert.deepEqual(planTodoPaste("HelloXXWorld", 5, 7, ["A", "", "BC"]), { first: "HelloA", following: ["", "BCWorld"], caretOffset: 2 });
});
test("Paste blank and newline-only content does not drop existing suffix", () => {
  assert.deepEqual(planTodoPaste("XY", 1, 1, ["", ""]), { first: "X", following: ["Y"], caretOffset: 0 });
  assert.deepEqual(planTodoPaste("", 0, 0, ["", "", ""]), { first: "", following: ["", ""], caretOffset: 0 });
});
test("Previous merge retains previous ID/status and exact caret offset", () => {
  const rows = [first, second];
  assert.deepEqual(mergeTodoRows(rows, 1, "previous"), { rows: [{ ...first, text: "AlphaBeta", creation: undefined }], caret: { rowId: first.id, offset: 5 } });
  assert.deepEqual(rows, [first, second]);
});
test("Next merge retains current ID/status and preserves empty existing rows", () => {
  assert.deepEqual(mergeTodoRows([first, second], 0, "next"), { rows: [{ ...first, text: "AlphaBeta", creation: undefined }], caret: { rowId: first.id, offset: 5 } });
  assert.deepEqual(mergeTodoRows([{ ...first, text: "" }, second], 0, "next"), { rows: [{ ...first, text: "Beta", creation: undefined }], caret: { rowId: first.id, offset: 0 } });
});
test("Merge ignores missing neighbors and the empty creation row", () => {
  assert.equal(mergeTodoRows([first], 0, "previous"), null);
  assert.equal(mergeTodoRows([first], 0, "next"), null);
  assert.equal(mergeTodoRows([], 3, "next"), null);
  assert.equal(mergeTodoRows([first, { ...second, creation: true, text: "" }], 0, "next"), null);
});
