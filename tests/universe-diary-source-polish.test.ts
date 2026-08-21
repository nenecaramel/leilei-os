import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paperSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url),
  "utf8",
);
const mobileCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-paper-web-mobile.css", import.meta.url),
  "utf8",
);
const appNavigationSource = readFileSync(
  new URL("../web/src/pages/app-navigation.ts", import.meta.url),
  "utf8",
);

test("Universe editor micro-labels use one explicit zero-padding left edge", () => {
  assert.match(
    mobileCss,
    /\.universe-standalone-form-field\s*>\s*label,\s*\.universe-standalone-galaxies\s*>\s*legend,\s*\.universe-standalone-strength-label\s*>\s*span\s*\{[^}]*margin:\s*0;[^}]*padding-inline:\s*0;/,
  );
});

test("Diary source picker heading is regular weight and exactly aligned with search text", () => {
  assert.doesNotMatch(
    paperSource,
    /universe-standalone-source-picker-head[^\n]*<strong>选择来源日记<\/strong>/,
  );
  assert.match(
    paperSource,
    /universe-standalone-source-picker-head[^\n]*<span>选择来源日记<\/span>/,
  );
  assert.match(
    mobileCss,
    /\.universe-standalone-source-picker-head\s*\{[^}]*padding-left:\s*13px;[^}]*font-size:\s*13px;[^}]*font-weight:\s*400;[^}]*line-height:\s*1\.35;/,
  );
});

test("opening Diary source picker minimally scrolls the complete search input into view", () => {
  assert.match(paperSource, /sourcePickerSearchRef\s*=\s*useRef<HTMLInputElement\s*\|\s*null>/);
  assert.match(paperSource, /ref=\{sourcePickerSearchRef\}/);
  assert.match(
    paperSource,
    /sourcePickerSearchRef\.current\?\.scrollIntoView\(\{[^}]*block:\s*"nearest"[^}]*\}\)/,
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
} catch {}
