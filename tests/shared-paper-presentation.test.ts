import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatSharedPaperDetailDateTime,
  formatSharedPaperRowDate,
  groupSharedPapersByMonth,
} from "../web/src/pages/shared-paper-presentation.js";

test("Shared Paper groups rows by updated month like Memory", () => {
  const papers = [
    { id: "a", updatedAt: "2026-09-16T18:43:00" },
    { id: "b", updatedAt: "2026-09-03T09:05:00" },
    { id: "c", updatedAt: "2026-08-31T23:59:00" },
  ];

  const groups = groupSharedPapersByMonth(papers);

  assert.deepEqual(
    groups.map((group) => ({
      label: group.label,
      ids: group.papers.map((paper) => paper.id),
    })),
    [
      { label: "2026年9月", ids: ["a", "b"] },
      { label: "2026年8月", ids: ["c"] },
    ],
  );
});

test("Shared Paper list rows use compact month/day dates", () => {
  assert.equal(formatSharedPaperRowDate("2026-09-16T18:43:00"), "9/16");
});

test("Shared Paper detail date includes dotted calendar date and exact minute", () => {
  assert.equal(
    formatSharedPaperDetailDateTime("2026-09-16T18:43:00"),
    "2026.09.16 18:43",
  );
});

test("Shared Paper page wires the same month-card structure as Memory and the detail timestamp formatter", () => {
  const page = readFileSync(
    new URL("../web/src/pages/SharedPaperPage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /groupSharedPapersByMonth\(papers\)/);
  assert.match(page, /className="memory-month-label">\{group\.label\}/);
  assert.match(page, /formatSharedPaperRowDate\(paper\.updatedAt\)/);
  assert.match(page, /dateLabel=\{formatSharedPaperDetailDateTime\(detail\.paper\.updatedAt\)\}/);
});
