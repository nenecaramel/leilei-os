import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { layoutDaySpacePapers } from "../web/src/pages/day-space-layout.js";
import { formatDaySpaceNavigationDate } from "../web/src/pages/day-space-location.js";

const page = readFileSync("web/src/pages/DaySpacePage.tsx", "utf8");
const styles = readFileSync("web/src/styles.css", "utf8");

function overlapFraction(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
) {
  const width = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  );
  const height = Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top),
  );
  const overlap = width * height;
  return overlap / Math.min(a.width * a.height, b.width * b.height);
}

test("Day Space v2 uses existing paper editors instead of its custom giant editor", () => {
  assert.match(page, /TodoPaperDialog/);
  assert.match(page, /DaySpaceDiaryDialog/);
  assert.doesNotMatch(page, /function DaySpaceEditorDialog/);
  assert.doesNotMatch(styles, /\.day-space-editor-paper/);
});

test("Day Space v2 preview papers are plain surfaces without ruled-paper texture", () => {
  const start = styles.indexOf("/* leilei-day-space-mobile-2026-08-09:start */");
  const end = styles.indexOf("/* leilei-day-space-mobile-2026-08-09:end */");
  const block = styles.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(block, /repeating-linear-gradient/);
});

test("Day Space v2 navigation date follows the approved English month label", () => {
  assert.equal(formatDaySpaceNavigationDate("2026-08-07"), "August 7, 2026");
});

test("two-paper days spread across the stage with only edge-level overlap", () => {
  const layout = layoutDaySpacePapers(
    "2026-08-07",
    [
      { id: "diary:diary-aug-07-l", density: 5 },
      { id: "todo:2026-08-07:L", density: 1 },
    ],
    345,
  );

  assert.equal(layout.items.length, 2);
  const [a, b] = layout.items;
  assert.ok(Math.abs(a.left - b.left) >= 58);
  assert.ok(overlapFraction(a, b) <= 0.15);
});

test("multi-paper days stay scattered and never become a centered vertical pile", () => {
  const layout = layoutDaySpacePapers(
    "2026-08-05",
    [
      { id: "todo:2026-08-05:L", density: 3 },
      { id: "todo:2026-08-05:G", density: 2 },
      { id: "diary:diary-aug-05-l", density: 5 },
      { id: "diary:diary-aug-05-g", density: 4 },
    ],
    345,
  );

  const lefts = layout.items.map((item) => item.left);
  assert.ok(Math.max(...lefts) - Math.min(...lefts) >= 105);

  for (let i = 0; i < layout.items.length; i += 1) {
    for (let j = i + 1; j < layout.items.length; j += 1) {
      assert.ok(
        overlapFraction(layout.items[i], layout.items[j]) <= 0.15,
        `${layout.items[i].id} overlaps ${layout.items[j].id} too much`,
      );
    }
  }
});
