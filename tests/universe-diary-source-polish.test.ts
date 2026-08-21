import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldReloadAcrossVisualSurface } from "../web/src/pages/app-navigation.js";

const finalGeometryCss = readFileSync(
  new URL("../web/src/pages/universe-mobile-final-geometry.css", import.meta.url),
  "utf8",
);
const appNavigationSource = readFileSync(
  new URL("../web/src/pages/app-navigation.ts", import.meta.url),
  "utf8",
);

test("Universe source field follows the same section spacing rhythm as the galaxy group", () => {
  assert.match(
    finalGeometryCss,
    /\.universe-standalone-source-field\s*\{[^}]*margin-top:\s*30px\s*!important;/,
  );
});

test("Universe and Diary cross-surface navigation reloads the document", () => {
  assert.equal(shouldReloadAcrossVisualSurface("/universe", "/diary"), true);
  assert.equal(shouldReloadAcrossVisualSurface("/diary", "/universe"), true);
  assert.equal(shouldReloadAcrossVisualSurface("/universe", "/search"), false);
  assert.equal(shouldReloadAcrossVisualSurface("/diary", "/search"), false);
  assert.match(
    appNavigationSource,
    /shouldReloadAcrossVisualSurface\(window\.location\.pathname,\s*targetPathname\)[\s\S]*window\.location\.assign\(location\);[\s\S]*return;/,
  );
});
