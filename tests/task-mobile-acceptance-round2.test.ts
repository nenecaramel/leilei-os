import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Task custom time range is wider and keeps iOS-safe optically smaller text", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const marker = css.indexOf(
    "/* leilei-task-mobile-acceptance-round2-2026-08-09:start */",
  );
  assert.ok(marker >= 0, "round-2 CSS marker must exist");
  const round = css.slice(marker);

  assert.match(
    round,
    /\.task-time-tool-wrap \.task-time-popover\s*\{[\s\S]*?width:\s*244px !important;/,
  );
  assert.match(
    round,
    /\.task-custom-range \.native-date-input\s*\{[\s\S]*?font-size:\s*16px !important;[\s\S]*?transform:\s*scale\(0\.875\);/,
  );
});

test("Task empty-filter clear action delegates to shared Memory and Diary styling", async () => {
  const css = await readFile("web/src/styles.css", "utf8");

  assert.doesNotMatch(
    css,
    /\.task-page \.memory-empty-state \.secondary-button\s*\{/,
  );
  assert.doesNotMatch(
    css,
    /\.task-page \.memory-empty-state \.secondary-button:hover/,
  );
});

test("Task paper metadata and deadline keep one read/edit baseline", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const marker = css.indexOf(
    "/* leilei-task-mobile-acceptance-round2-2026-08-09:start */",
  );
  assert.ok(marker >= 0);
  const round = css.slice(marker);

  assert.match(
    round,
    /\.paper-detail-paper\[id\^="task-"\] \.paper-detail-date\s*\{[\s\S]*?height:\s*20px;[\s\S]*?line-height:\s*20px;/,
  );
  assert.match(
    round,
    /\.task-paper-metadata\s*\{[\s\S]*?height:\s*20px;/,
  );
  assert.match(
    round,
    /\.task-paper-tags\s*\{[\s\S]*?height:\s*24\.615385px;[\s\S]*?transform:\s*scale\(0\.8125\);/,
  );
});

test("Task read-mode status is already an actionable legal-transition menu", async () => {
  const paper = await readFile("web/src/pages/TaskPaperEditor.tsx", "utf8");

  assert.match(paper, /aria-label="任务状态"/);
  assert.match(paper, /aria-label="Task 状态操作"/);
  assert.match(paper, /(?:props\.)?actions\.map\(/);
  assert.match(paper, /(?:props\.)?onAction\?\.\(/);
});
