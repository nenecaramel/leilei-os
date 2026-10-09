import assert from "node:assert/strict";
import test from "node:test";
import { layoutDaySpacePapers } from "../web/src/pages/day-space-layout.js";

const papers = [
  { id: "todo:2026-08-05:L", density: 3 },
  { id: "diary:rain", density: 5 },
  { id: "todo:2026-08-05:G", density: 2 },
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

  const finalBottom = Math.max(
    ...first.items.map((item) => item.top + item.height),
  );
  assert.ok(first.stageHeight >= finalBottom);
});

test("adding papers grows the vertical paper field", () => {
  const short = layoutDaySpacePapers("2026-08-05", papers.slice(0, 2), 345);
  const long = layoutDaySpacePapers("2026-08-05", papers, 345);
  assert.ok(long.stageHeight > short.stageHeight);
});

test("preview line budgets leave room for complete lines and overflow dots", async () => {
  const { daySpacePreviewLineLimit } =
    await import("../web/src/pages/day-space-layout.js");
  for (const [size, height, limit] of [
    ["small", 112, 2],
    ["medium", 134, 3],
    ["large", 158, 4],
  ] as const) {
    for (const kind of ["todo", "memory"] as const) {
      for (let count = 1; count <= limit; count++) {
        for (const hasMore of [false, true]) {
          const lines = daySpacePreviewLineLimit(size, kind, count, hasMore);
          const gap = kind === "todo" ? 7 : 8;
          const line = kind === "todo" ? 14.7 : 15.2;
          assert.ok(
            count * lines * line +
              (count - 1) * gap +
              (hasMore ? 11 + gap : 0) <=
              height - 39,
          );
        }
      }
    }
  }
  assert.equal(daySpacePreviewLineLimit("large", "memory", 1, false), 2);
});
