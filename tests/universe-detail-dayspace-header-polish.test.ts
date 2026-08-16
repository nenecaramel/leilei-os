import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const polishCss = readFileSync(
  new URL("../web/src/pages/universe-detail-dayspace-header-polish.css", import.meta.url),
  "utf8",
);

test("Universe detail swaps time/type visually without moving the shared edge spacing", () => {
  assert.match(polishCss, /\.universe-standalone-detail-head \.universe-standalone-updated\s*\{[\s\S]*?order:\s*-1/);
  assert.match(polishCss, /\.universe-standalone-summary\s*\{[\s\S]*?margin-top:\s*4px/);
});

test("Day Space restores a full white mobile top-bar surface at the shared 44px geometry", () => {
  assert.match(polishCss, /\.app-shell:has\(\.day-space-page\) \.mobile-top-bar\s*\{[\s\S]*?min-height:\s*calc\(44px \+ env\(safe-area-inset-top, 0px\)\)/);
  assert.match(polishCss, /height:\s*calc\(44px \+ env\(safe-area-inset-top, 0px\)\)/);
  assert.match(polishCss, /background:\s*#ffffff !important/);
  assert.match(polishCss, /border-bottom:\s*1px solid rgba\(0, 0, 0, 0\.08\)/);
});

test("Universe homepage floating-header redesign is not included in this polish file", () => {
  assert.doesNotMatch(polishCss, /universe-page[\s\S]*mobile-top-bar/);
  assert.doesNotMatch(polishCss, /universe-toolbar/);
});
