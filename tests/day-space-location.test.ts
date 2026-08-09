import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDaySpaceLocation,
  isBusinessDate,
  parseExplicitDaySpaceDate,
  resolveLatestBusinessDate,
  shiftBusinessDate,
} from "../web/src/pages/day-space-location.js";
import {
  listPersistedTodoPaperDates,
  todoPaperStorageKey,
} from "../web/src/pages/todo-paper-storage.js";

test("Day Space parses only valid explicit business dates", () => {
  assert.equal(parseExplicitDaySpaceDate("?date=2026-08-05"), "2026-08-05");
  assert.equal(parseExplicitDaySpaceDate("?date=2026-02-30"), null);
  assert.equal(parseExplicitDaySpaceDate("?date=nope"), null);
  assert.equal(parseExplicitDaySpaceDate(""), null);
  assert.equal(isBusinessDate("2024-02-29"), true);
  assert.equal(isBusinessDate("2025-02-29"), false);
});

test("Day Space shifts local business dates across month and year boundaries", () => {
  assert.equal(shiftBusinessDate("2026-08-05", -1), "2026-08-04");
  assert.equal(shiftBusinessDate("2026-08-31", 1), "2026-09-01");
  assert.equal(shiftBusinessDate("2026-01-01", -1), "2025-12-31");
});

test("Day Space resolves the latest visible content date and otherwise today", () => {
  assert.equal(
    resolveLatestBusinessDate(["2026-08-02", "2026-08-09", "2026-08-05"], "2026-08-10"),
    "2026-08-09",
  );
  assert.equal(resolveLatestBusinessDate([], "2026-08-10"), "2026-08-10");
  assert.equal(buildDaySpaceLocation("2026-08-05"), "/day-space?date=2026-08-05");
});

test("persisted Todo date discovery ignores malformed, unrelated and empty papers", () => {
  const map = new Map<string, string>([
    [
      todoPaperStorageKey("L", "2026-08-06"),
      JSON.stringify([{ id: "l-1", author: "L", kind: "pending", text: "real content" }]),
    ],
    [todoPaperStorageKey("G", "2026-08-07"), JSON.stringify([])],
    [todoPaperStorageKey("G", "2026-08-08"), "{broken"],
    ["unrelated:key", JSON.stringify([{ id: "x" }])],
  ]);

  const storage = {
    get length() {
      return map.size;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
  };

  assert.deepEqual(listPersistedTodoPaperDates(storage), ["2026-08-06"]);
});
