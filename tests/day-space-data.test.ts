import assert from "node:assert/strict";
import test from "node:test";
import { composeDaySpacePapers, resolveDaySpaceDefaultDate } from "../web/src/pages/day-space-data.js";

test("Day Space default date uses latest union and tracks complete discovery", () => {
  assert.deepEqual(resolveDaySpaceDefaultDate({
    todo: { status: "success", dates: ["2026-08-01"] },
    diary: { status: "success", dates: ["2026-08-03"] },
  }, "2026-08-04"), { status: "ready", date: "2026-08-03", discoveryIncomplete: false });
  assert.deepEqual(resolveDaySpaceDefaultDate({
    todo: { status: "success", dates: [] },
    diary: { status: "success", dates: [] },
  }, "2026-08-04"), { status: "ready", date: "2026-08-04", discoveryIncomplete: false });
});

test("Day Space resolves partial discovery without claiming global completeness", () => {
  assert.deepEqual(resolveDaySpaceDefaultDate({
    todo: { status: "success", dates: ["2026-08-01"] },
    diary: { status: "error" },
  }, "2026-08-04"), { status: "ready", date: "2026-08-01", discoveryIncomplete: true });
  assert.deepEqual(resolveDaySpaceDefaultDate({
    todo: { status: "success", dates: [] },
    diary: { status: "error" },
  }, "2026-08-04"), { status: "ready", date: "2026-08-04", discoveryIncomplete: true });
  assert.deepEqual(resolveDaySpaceDefaultDate({ todo: { status: "error" }, diary: { status: "error" } }, "2026-08-04"), { status: "error" });
});

test("Day Space composes only non-empty Todo papers and preserves separate Diary ids", () => {
  const result = composeDaySpacePapers("2026-08-04", {
    date: "2026-08-04",
    papers: {
      L: { author: "L", date: "2026-08-04", revision: 1, entries: [{ id: "l", kind: "pending", text: "L" }] },
      G: { author: "G", date: "2026-08-04", revision: 1, entries: [] },
      C: null,
    },
  }, [
    { id: "d1", title: "One", content: "Body", date: "2026-08-04", author: null, tags: [], mood: null, created_at: "x", updated_at: "x" },
    { id: "d2", title: "Two", content: "Body", date: "2026-08-04", author: "G", tags: [], mood: null, created_at: "x", updated_at: "x" },
  ]);
  assert.deepEqual(result.map((paper) => paper.id), ["todo:2026-08-04:L", "diary:d1", "diary:d2"]);
});

test("Day Space composes a non-empty C Todo paper with its stable id", () => {
  const day = {
    date: "2026-09-05",
    papers: {
      L: null,
      G: null,
      C: {
        author: "C" as const,
        date: "2026-09-05",
        revision: 2,
        entries: [{ id: "c-1", kind: "pending" as const, text: "C paper" }],
      },
    },
  };

  assert.equal(composeDaySpacePapers(day.date, day, [])[0]?.id, "todo:2026-09-05:C");
});

test("Day Space omits an empty C Todo paper", () => {
  const result = composeDaySpacePapers("2026-09-05", {
    date: "2026-09-05",
    papers: {
      L: null,
      G: null,
      C: { author: "C", date: "2026-09-05", revision: 2, entries: [] },
    },
  }, []);

  assert.deepEqual(result, []);
});
