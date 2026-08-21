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
const finalGeometryCss = readFileSync(
  new URL("../web/src/pages/universe-mobile-final-geometry.css", import.meta.url),
  "utf8",
);
const appNavigationSource = readFileSync(
  new URL("../web/src/pages/app-navigation.ts", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(
  new URL("../web/src/layout/AppShell.tsx", import.meta.url),
  "utf8",
);
const indexHtml = readFileSync(
  new URL("../web/index.html", import.meta.url),
  "utf8",
);

test("Universe source field follows the form left edge and section rhythm", () => {
  assert.match(
    finalGeometryCss,
    /\.universe-standalone-source-field\s*\{[^}]*margin-top:\s*30px\s*!important;[^}]*margin-left:\s*0\s*!important;[^}]*padding-left:\s*0\s*!important;/,
  );
  assert.match(
    finalGeometryCss,
    /\.universe-standalone-source-field\s*>\s*label\s*\{[^}]*margin-left:\s*0\s*!important;[^}]*padding-left:\s*0\s*!important;/,
  );
});

test("Diary source picker heading is regular weight and aligned with search text", () => {
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
    /\.universe-standalone-source-picker-head\s*\{[^}]*padding-left:\s*12px;[^}]*font-weight:\s*400;/,
  );
});

test("opening the Diary source picker scrolls the full search input into view", () => {
  assert.match(paperSource, /sourcePickerSearchRef\s*=\s*useRef<HTMLInputElement\s*\|\s*null>/);
  assert.match(paperSource, /ref=\{sourcePickerSearchRef\}/);
  assert.match(
    paperSource,
    /sourcePickerOpen[\s\S]*sourcePickerSearchRef\.current\?\.scrollIntoView\(\{[\s\S]*behavior:\s*"smooth"[\s\S]*block:\s*"center"[\s\S]*\}\)/,
  );
});

test("Universe and Diary navigation stays inside the SPA so browser auth memory survives", () => {
  assert.doesNotMatch(appNavigationSource, /window\.location\.assign\(/);
  assert.match(appNavigationSource, /window\.history\.pushState\(/);
});

test("SPA route changes keep browser chrome in sync with light and dark surfaces", () => {
  assert.match(appShellSource, /useLocation/);
  assert.match(appShellSource, /location\.pathname\s*===\s*"\/universe"\s*\?\s*"#0b0c12"\s*:\s*"#ebeae4"/);
  assert.match(appShellSource, /syncThemeColorMeta\(document,\s*routeThemeColor\)/);
  assert.match(indexHtml, /id="theme-color"\s+name="theme-color"\s+content="#ebeae4"/);
  assert.match(
    indexHtml,
    /window\.location\.pathname === "\/universe"[\s\S]*themeColor\.content = "#0b0c12"/,
  );
});
