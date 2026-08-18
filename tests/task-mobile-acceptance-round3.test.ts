import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Task custom datetime is vertically centered after optical scaling", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const marker = css.indexOf(
    "/* leilei-task-mobile-acceptance-round3-2026-08-09:start */",
  );
  assert.ok(marker >= 0, "round-3 CSS marker must exist");
  const round = css.slice(marker);

  assert.match(
    round,
    /\.task-custom-range \.native-date-input\s*\{[\s\S]*?top:\s*-2\.428571px;/,
  );
});

test("Task clear-filter action uses the shared Memory/Diary styling with no Task override", async () => {
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

test("Task first three header tools use Diary's accepted 6 4 2 optical offsets", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const marker = css.indexOf(
    "/* leilei-task-mobile-acceptance-round3-2026-08-09:start */",
  );
  assert.ok(marker >= 0);
  const round = css.slice(marker);

  for (const [index, left] of [[1, 6], [2, 4], [3, 2]] as const) {
    assert.match(
      round,
      new RegExp(
        String.raw`\.task-page-tools\s*>\s*\.memory-page-tool-wrap:nth-child\(${index}\)\s*>\s*button\s*>\s*\*\s*\{[\s\S]*?left:\s*${left}px;`,
      ),
    );
  }
});

test("archive detail loading copy is consistently '正在读取归档xx' without 已", async () => {
  const memory = await readFile("web/src/pages/MemoryPage.tsx", "utf8");
  const diary = await readFile("web/src/pages/DiaryPage.tsx", "utf8");
  const task = await readFile("web/src/pages/TaskPage.tsx", "utf8");

  assert.match(memory, /正在读取归档记忆/);
  assert.doesNotMatch(memory, /正在读取已归档记忆/);
  assert.match(diary, /正在读取归档日记/);
  assert.match(task, /正在读取归档任务/);
});
