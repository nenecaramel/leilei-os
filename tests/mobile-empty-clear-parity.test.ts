import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Memory Diary and Task mobile empty-filter actions use the dedicated plain-text clear control", async () => {
  const memory = await readFile("web/src/pages/MemoryPage.tsx", "utf8");
  const diary = await readFile("web/src/pages/DiaryPage.tsx", "utf8");
  const task = await readFile("web/src/pages/TaskPage.tsx", "utf8");

  assert.match(
    memory,
    /className="secondary-button memory-empty-clear"[\s\S]{0,180}?清除筛选/,
  );
  assert.match(
    diary,
    /className="secondary-button memory-empty-clear"[\s\S]{0,180}?清除条件/,
  );
  assert.match(
    task,
    /className="secondary-button memory-empty-clear"[\s\S]{0,180}?清除条件/,
  );
});

test("mobile empty clear resets legacy and native button appearance completely", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const marker = css.indexOf(
    "/* leilei-mobile-empty-clear-exact-parity-2026-08-09:start */",
  );
  assert.ok(marker >= 0);
  const round = css.slice(marker);

  assert.match(
    round,
    /\.memory-empty-state\s*>\s*\.memory-empty-clear\s*\{[\s\S]*?all:\s*unset;[\s\S]*?-webkit-appearance:\s*none;[\s\S]*?appearance:\s*none;[\s\S]*?display:\s*inline-block;[\s\S]*?cursor:\s*pointer;/,
  );
});
