import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDaySpaceLocation,
  isBusinessDate,
  parseExplicitDaySpaceDate,
  resolveLatestBusinessDate,
  shiftBusinessDate,
} from "../web/src/pages/day-space-location.js";


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
