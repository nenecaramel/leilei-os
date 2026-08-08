import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all mobile empty-filter clear buttons share one borderless typography rule", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const marker = css.indexOf(
    "/* leilei-task-mobile-acceptance-round4-2026-08-09:start */",
  );
  assert.ok(marker >= 0, "round-4 CSS marker must exist");
  const round = css.slice(marker);

  assert.match(
    round,
    /\.memory-empty-state\s*>\s*\.secondary-button\s*\{[\s\S]*?min-height:\s*auto;[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?font-size:\s*14px;[\s\S]*?font-weight:\s*400;/,
  );
  assert.doesNotMatch(
    round,
    /\.task-page \.memory-empty-state \.secondary-button/,
  );
});

test("Task first two tool centers use Diary offsets with equal selector strength", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const marker = css.indexOf(
    "/* leilei-task-mobile-acceptance-round4-2026-08-09:start */",
  );
  assert.ok(marker >= 0);
  const round = css.slice(marker);

  assert.match(
    round,
    /\.memory-page-tools\.task-page-tools\s*>\s*\.memory-page-tool-wrap:nth-child\(1\)[\s\S]*?left:\s*6px;/,
  );
  assert.match(
    round,
    /\.memory-page-tools\.task-page-tools\s*>\s*\.memory-page-tool-wrap:nth-child\(2\)[\s\S]*?left:\s*4px;/,
  );
});

test("Task status glyph uses the same 19px visual box as Diary mood", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const marker = css.indexOf(
    "/* leilei-task-mobile-acceptance-round4-2026-08-09:start */",
  );
  assert.ok(marker >= 0);
  const round = css.slice(marker);

  assert.match(
    round,
    /\.task-page-status-icon\s*\{[\s\S]*?width:\s*19px !important;[\s\S]*?height:\s*19px !important;/,
  );
});
