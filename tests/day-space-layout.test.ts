import assert from "node:assert/strict";
import test from "node:test";
import { layoutDaySpacePapers } from "../web/src/pages/day-space-layout.js";

const papers = [
  { id: "todo:L:2026-08-05", density: 3 },
  { id: "diary:rain", density: 5 },
  { id: "todo:G:2026-08-05", density: 2 },
  { id: "diary:late", density: 4 },
];

test("controlled scatter is deterministic for the same date and width", () => {
  const first = layoutDaySpacePapers("2026-08-05", papers, 345);
  const second = layoutDaySpacePapers("2026-08-05", papers, 345);
  assert.deepEqual(first, second);
});

test("controlled scatter changes with date while staying inside the stage", () => {
  const first = layoutDaySpacePapers("2026-08-05", papers, 345);
  const second = layoutDaySpacePapers("2026-08-06", papers, 345);

  assert.notDeepEqual(first.items, second.items);

  for (const item of first.items) {
    assert.ok(item.left >= 0);
    assert.ok(item.top >= 0);
    assert.ok(item.left + item.width <= 345.001);
    assert.ok(item.rotation >= -4 && item.rotation <= 4);
    assert.ok(["small", "medium", "large"].includes(item.size));
    assert.ok(item.zIndex >= 1);
  }

  const finalBottom = Math.max(...first.items.map((item) => item.top + item.height));
  assert.ok(first.stageHeight >= finalBottom);
});

test("adding papers grows the vertical paper field", () => {
  const short = layoutDaySpacePapers("2026-08-05", papers.slice(0, 2), 345);
  const long = layoutDaySpacePapers("2026-08-05", papers, 345);
  assert.ok(long.stageHeight > short.stageHeight);
});
