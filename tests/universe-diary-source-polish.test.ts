import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mobileCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-paper-web-mobile.css", import.meta.url),
  "utf8",
);
const appNavigationSource = readFileSync(
  new URL("../web/src/pages/app-navigation.ts", import.meta.url),
  "utf8",
);
const universePageSource = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
);
const diaryPageSource = readFileSync(
  new URL("../web/src/pages/DiaryPage.tsx", import.meta.url),
  "utf8",
);

test("Universe source field follows the same section spacing rhythm as the galaxy group", () => {
  assert.match(
    mobileCss,
    /\.universe-standalone-source-field\s*\{[^}]*margin-top:\s*30px;/,
  );
});

test("Universe and Diary provenance cross-surface navigation reloads the document", () => {
  assert.match(
    appNavigationSource,
    /export function navigateAcrossVisualSurface\([\s\S]*window\.location\.assign\(location\)/,
  );
  assert.match(universePageSource, /navigateAcrossVisualSurface\(next\)/);
  assert.ok(
    [...diaryPageSource.matchAll(/navigateAcrossVisualSurface\(returnTo\)/g)].length >= 4,
    "all direct Diary → Universe return paths should reload across the light/dark surface boundary",
  );
});
