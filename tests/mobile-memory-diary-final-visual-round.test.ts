import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("web/src/styles.css", "utf8");
const diary = await readFile("web/src/pages/DiaryPage.tsx", "utf8");

const startMarker =
  "/* leilei-final-mobile-visual-round-2026-08-08:start */";
const endMarker =
  "/* leilei-final-mobile-visual-round-2026-08-08:end */";

function finalRoundCss(): string {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker);
  assert.notEqual(start, -1, "final visual-round CSS marker must exist");
  assert.notEqual(end, -1, "final visual-round CSS end marker must exist");
  return css.slice(start, end + endMarker.length);
}

test("paper body and metadata editors keep iPhone focus-safe 16px text", () => {
  const block = finalRoundCss();
  assert.match(
    block,
    /\.memory-paper-content-editor,[\s\S]*?\.diary-paper-content-editor[\s\S]*?font-size:\s*16px\s*!important;/,
  );
  assert.match(
    block,
    /\.memory-paper-tags,[\s\S]*?\.diary-paper-mood,[\s\S]*?\.diary-paper-tags[\s\S]*?font-size:\s*16px\s*!important;[\s\S]*?zoom:\s*1\s*!important;/,
  );
});

test("Diary filter text controls are 16px focus-safe while text popovers are narrower", () => {
  const block = finalRoundCss();
  assert.match(
    block,
    /\.diary-text-popover\s*\{[\s\S]*?width:\s*160px\s*!important;/,
  );
  assert.match(
    block,
    /\.diary-filter-popover input[\s\S]*?font-size:\s*16px\s*!important;/,
  );
});

test("Diary date filter has no gray trigger tile and native date stays inside its popover", () => {
  const block = finalRoundCss();
  assert.match(
    block,
    /\.diary-page-tools[\s\S]*?>\s*\.memory-page-tool-wrap:nth-child\(-n\s*\+\s*3\)[\s\S]*?>\s*button[\s\S]*?background:\s*transparent\s*!important;/,
  );
  assert.match(
    block,
    /\.diary-date-popover\s*\{[\s\S]*?width:\s*244px\s*!important;/,
  );
  assert.match(
    block,
    /\.diary-date-popover \.native-date-input\s*\{[\s\S]*?inline-size:\s*100%\s*!important;[\s\S]*?max-inline-size:\s*100%\s*!important;[\s\S]*?font-size:\s*16px\s*!important;[\s\S]*?text-align:\s*center\s*!important;/,
  );
  assert.match(
    block,
    /::-webkit-date-and-time-value\s*\{[\s\S]*?text-align:\s*center\s*!important;/,
  );
  assert.match(diary, /NativeDateInput/);
});

test("Archive and create glyphs use the darker final middle gray", () => {
  const block = finalRoundCss();
  assert.match(
    block,
    /\.memory-page-tools\s*>\s*button:nth-last-child\(-n\s*\+\s*2\),[\s\S]*?\.diary-page-tools\s*>\s*button:nth-last-child\(-n\s*\+\s*2\)[\s\S]*?color:\s*#444444\s*!important;/,
  );
});

test("both Archive Return headers pull inward from the card right edge", () => {
  const block = finalRoundCss();
  assert.match(
    block,
    /\.memory-archive-header,[\s\S]*?\.diary-archive-header\s*\{[\s\S]*?padding-right:\s*12px\s*!important;/,
  );
});

test("paper top-right actions visually align with the date row", () => {
  const block = finalRoundCss();
  assert.match(
    block,
    /\.paper-detail-top-right\s*\{[\s\S]*?top:\s*13px\s*!important;[\s\S]*?height:\s*20px\s*!important;/,
  );
  assert.match(
    block,
    /\.paper-detail-top-right button\s*\{[\s\S]*?height:\s*20px\s*!important;[\s\S]*?min-height:\s*20px\s*!important;[\s\S]*?line-height:\s*20px\s*!important;/,
  );
});
