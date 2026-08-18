import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Task time filter stays inside the phone and archive reuses accepted Return geometry", async () => {
  const header = await readFile("web/src/pages/TaskPageHeader.tsx", "utf8");
  const page = await readFile("web/src/pages/TaskPage.tsx", "utf8");
  const css = await readFile("web/src/styles.css", "utf8");

  assert.match(header, /memory-page-tool-wrap task-time-tool-wrap/);
  assert.match(
    page,
    /memory-page-header memory-archive-header task-archive-header/,
  );
  assert.match(
    css,
    /\.task-time-tool-wrap \.task-time-popover\s*\{[\s\S]*?left:\s*0;[\s\S]*?width:\s*176px;/,
  );
  assert.match(css, /max-width:\s*calc\(100vw - 48px\)/);
});

test("Task paper copies the accepted Memory and Diary paper geometry and focus reset", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const paper = await readFile("web/src/pages/TaskPaperEditor.tsx", "utf8");

  assert.match(css, /leilei-task-mobile-visual-polish-2026-08-09:start/);
  assert.match(
    css,
    /\.paper-detail-paper\[id\^="task-"\] \.memory-paper-title/,
  );
  assert.match(
    css,
    /\.paper-detail-paper\[id\^="task-"\] \.task-paper-title-editor/,
  );
  assert.match(
    css,
    /\.paper-detail-paper\[id\^="task-"\] \.task-paper-description-editor/,
  );
  assert.match(
    css,
    /\.paper-detail-paper\[id\^="task-"\] input:focus/,
  );
  assert.match(
    css,
    /\.paper-detail-paper\[id\^="task-"\] \.paper-detail-bottom-left/,
  );
  assert.match(
    css,
    /\.task-paper-status\s*\{[\s\S]*?height:\s*20px;[\s\S]*?line-height:\s*20px;/,
  );
  assert.doesNotMatch(
    css,
    /\.task-paper-title-editor\s*\{\s*transform:\s*scale\(1\.0625\)/,
  );
  assert.match(paper, /autoComplete="off"/);
});

test("Archived Memory detail loading uses the same paper dialog family as current details", async () => {
  const source = await readFile("web/src/pages/MemoryPage.tsx", "utf8");
  const start = source.indexOf("function ArchivedMemoryDetail(");
  const end = source.indexOf("function MemoryDetail(", start);
  assert.ok(start >= 0 && end > start);

  const archivedDetail = source.slice(start, end);
  const loadingStart = archivedDetail.indexOf('if (state.status === "loading")');
  const errorStart = archivedDetail.indexOf(
    'if (state.status === "error"',
    loadingStart,
  );
  assert.ok(loadingStart >= 0 && errorStart > loadingStart);

  const loading = archivedDetail.slice(loadingStart, errorStart);
  assert.match(loading, /<PaperDetailDialog/);
  assert.doesNotMatch(loading, /<MemoryMessage/);
  assert.match(loading, /id="memory-archive-detail-paper"/);
});
