import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appNavigation = await import("../web/src/pages/app-navigation.js");
const finalGeometryCss = readFileSync(
  new URL("../web/src/pages/universe-mobile-final-geometry.css", import.meta.url),
  "utf8",
);
const appNavigationSource = readFileSync(
  new URL("../web/src/pages/app-navigation.ts", import.meta.url),
  "utf8",
);
const indexHtml = readFileSync(
  new URL("../web/index.html", import.meta.url),
  "utf8",
);

test("Universe source field follows the same section spacing rhythm as the galaxy group", () => {
  assert.match(
    finalGeometryCss,
    /\.universe-standalone-source-field\s*\{[^}]*margin-top:\s*30px\s*!important;/,
  );
});

test("Universe and Diary cross-surface navigation reloads the document", () => {
  const shouldReloadAcrossVisualSurface = appNavigation.shouldReloadAcrossVisualSurface;
  assert.equal(typeof shouldReloadAcrossVisualSurface, "function");
  assert.equal(shouldReloadAcrossVisualSurface("/universe", "/diary"), true);
  assert.equal(shouldReloadAcrossVisualSurface("/diary", "/universe"), true);
  assert.equal(shouldReloadAcrossVisualSurface("/universe", "/search"), false);
  assert.equal(shouldReloadAcrossVisualSurface("/diary", "/search"), false);
  assert.match(
    appNavigationSource,
    /shouldReloadAcrossVisualSurface\(window\.location\.pathname,\s*targetPathname\)[\s\S]*window\.location\.assign\(location\);[\s\S]*return;/,
  );
});

test("hard reload initializes browser chrome for the destination visual surface", () => {
  assert.match(indexHtml, /id="theme-color"\s+name="theme-color"\s+content="#ebeae4"/);
  assert.match(
    indexHtml,
    /window\.location\.pathname === "\/universe"[\s\S]*themeColor\.content = "#0b0c12"/,
  );
});
