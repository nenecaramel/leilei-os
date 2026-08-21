import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const finalGeometryCss = readFileSync(
  new URL("../web/src/pages/universe-mobile-final-geometry.css", import.meta.url),
  "utf8",
);
const appNavigationSource = readFileSync(
  new URL("../web/src/pages/app-navigation.ts", import.meta.url),
  "utf8",
);
let sourcePickerAutoRevealSource = "";
try {
  sourcePickerAutoRevealSource = readFileSync(
    new URL("../web/src/pages/universe/source-picker-auto-reveal.ts", import.meta.url),
    "utf8",
  );
} catch {
  sourcePickerAutoRevealSource = "";
}

test("Universe editor micro-labels use one explicit zero-padding left edge", () => {
  assert.match(
    finalGeometryCss,
    /\.universe-standalone-form-field\s*>\s*label,\s*\.universe-standalone-galaxies\s*>\s*legend,\s*\.universe-standalone-strength-label\s*>\s*span\s*\{[^}]*padding-inline:\s*0\s*!important;/,
  );
});

test("Diary source picker heading is regular weight and exactly aligned with search text", () => {
  assert.match(
    finalGeometryCss,
    /\.universe-standalone-source-picker-head\s*\{[^}]*padding-left:\s*13px\s*!important;[^}]*font-size:\s*13px\s*!important;[^}]*line-height:\s*1\.35\s*!important;/,
  );
  assert.match(
    finalGeometryCss,
    /\.universe-standalone-source-picker-head\s+strong\s*\{[^}]*font-weight:\s*400\s*!important;/,
  );
});

test("opening Diary source picker minimally scrolls the complete search input into view", () => {
  assert.match(sourcePickerAutoRevealSource, /universe-standalone-source-add/);
  assert.match(sourcePickerAutoRevealSource, /搜索来源日记/);
  assert.match(
    sourcePickerAutoRevealSource,
    /scrollIntoView\(\{[^}]*block:\s*"nearest"[^}]*\}\)/,
  );
});

test("Universe and Diary provenance navigation stays inside the SPA so browser auth memory survives", () => {
  assert.doesNotMatch(appNavigationSource, /window\.location\.assign\(/);
  assert.match(appNavigationSource, /window\.history\.pushState\(/);
});

test("Universe Diary SPA crossing switches browser chrome to the destination surface color", () => {
  assert.match(
    appNavigationSource,
    /targetPathname\s*===\s*"\/universe"[\s\S]*"#0b0c12"[\s\S]*targetPathname\s*===\s*"\/diary"[\s\S]*"#ebeae4"/,
  );
  assert.match(
    appNavigationSource,
    /meta\[name=["']theme-color["']\][\s\S]*setAttribute\(["']content["'],\s*themeColor\)/,
  );
});
