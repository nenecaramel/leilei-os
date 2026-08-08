import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMemoryPaperDate,
  formatMemoryRowDate,
  formatMemoryRowMeta,
  getMemoryRowTitle,
  groupMemoriesByMonth,
} from "../web/src/pages/memory-presentation.js";

const records = [
  {
    id: "a",
    category: "goal",
    key: "august_goal",
    content: "A",
    tags: ["focus"],
    updated_at: "2026-08-07T12:00:00.000Z",
  },
  {
    id: "b",
    category: "goal",
    key: "",
    content: "\nFirst visible line\nSecond",
    tags: [],
    updated_at: "2026-08-01T08:00:00.000Z",
  },
  {
    id: "c",
    category: "project",
    key: "july_project",
    content: "C",
    tags: ["OS", "UI"],
    updated_at: "2026-07-31T12:00:00.000Z",
  },
  {
    id: "d",
    category: "profile",
    key: "unknown",
    content: "D",
    tags: [],
    updated_at: "not-a-date",
  },
];

test("Memory presentation groups months in input order and keeps unknown time last", () => {
  const groups = groupMemoriesByMonth(records);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].memories.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(groups[1].memories.map((item) => item.id), ["c"]);
  assert.equal(groups[2].label, "时间未知");
  assert.deepEqual(groups[2].memories.map((item) => item.id), ["d"]);
});

test("Memory row title prefers key then first non-empty content line", () => {
  assert.equal(getMemoryRowTitle(records[0]), "august_goal");
  assert.equal(getMemoryRowTitle(records[1]), "First visible line");
});

test("Memory row metadata never leaves a dangling separator", () => {
  assert.equal(formatMemoryRowMeta(records[0], "Goal"), "Goal · #focus");
  assert.equal(formatMemoryRowMeta(records[1], "Goal"), "Goal");
  assert.equal(formatMemoryRowMeta(records[2], "Project"), "Project · #OS #UI");
});

test("Memory row and paper dates are safe and use the shared visual separators", () => {
  const date = new Date(records[0].updated_at);
  const expectedRow = `${date.getMonth() + 1}/${date.getDate()}`;
  const expectedPaper = [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join(".");

  assert.equal(formatMemoryRowDate(records[0].updated_at), expectedRow);
  assert.equal(formatMemoryRowDate("invalid"), "时间未知");
  assert.equal(formatMemoryPaperDate(records[0].updated_at), expectedPaper);
  assert.equal(formatMemoryPaperDate("invalid"), "时间未知");
});
