import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDiaryPaperDate,
  formatDiaryRowDate,
  formatDiaryRowMeta,
  groupDiariesByMonth,
} from "../web/src/pages/diary-presentation.js";

const august = {
  id: "d1",
  title: "A",
  date: "2026-08-08",
  tags: ["work", "MCP"],
  mood: "calm",
};

test("Diary presentation groups by the domain date without timezone drift", () => {
  const groups = groupDiariesByMonth([
    august,
    { ...august, id: "d2", date: "2026-08-01" },
    { ...august, id: "d3", date: "2026-07-31" },
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      key: group.key,
      label: group.label,
      ids: group.diaries.map((diary) => diary.id),
    })),
    [
      { key: "2026-08", label: "2026年8月", ids: ["d1", "d2"] },
      { key: "2026-07", label: "2026年7月", ids: ["d3"] },
    ],
  );
  assert.equal(formatDiaryRowDate("2026-08-08"), "8月8日");
  assert.equal(formatDiaryPaperDate("2026-08-08"), "2026.08.08");
});

test("Diary metadata omits empty parts without stray separators", () => {
  assert.equal(formatDiaryRowMeta(august), "calm · #work #MCP");
  assert.equal(
    formatDiaryRowMeta({ mood: "calm", tags: [] }),
    "calm",
  );
  assert.equal(
    formatDiaryRowMeta({ mood: null, tags: ["work"] }),
    "#work",
  );
  assert.equal(
    formatDiaryRowMeta({ mood: null, tags: [] }),
    "",
  );
});
