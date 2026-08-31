import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const cssUrl = new URL("../web/src/desktop-mobile-parity.css", import.meta.url);
const mainTsx = readFileSync(new URL("../web/src/main.tsx", import.meta.url), "utf8");

function readCss() {
  assert.equal(existsSync(cssUrl), true, "desktop-mobile-parity.css must exist");
  return readFileSync(cssUrl, "utf8");
}

test("desktop mobile-parity stylesheet is the final page-geometry cascade layer", () => {
  assert.match(
    mainTsx,
    /import "\.\/pages\/universe-home-dark-production-fixes\.css";\s*import "\.\/desktop-mobile-parity\.css";/s,
  );
});

test("desktop keeps the accepted mobile visual language for all six target pages", () => {
  const css = readCss();
  assert.match(css, /@media\s*\(min-width:\s*761px\)/);
  for (const selector of [
    ".memory-page",
    ".diary-page",
    ".task-page",
    ".day-space-page",
    ".global-search-page",
    ".universe-page",
  ]) {
    assert.match(css, new RegExp(selector.replace(".", "\\.")));
  }
  assert.doesNotMatch(css, /\.sidebar|\.navigation-panel|\.mobile-top-bar|\.mobile-drawer/);
});

test("target light pages explicitly own their fluid frame over the shared desktop page rule", () => {
  const css = readCss();
  assert.match(
    css,
    /\.main-content\s*>\s*\.page\.memory-page,[\s\S]*\.main-content\s*>\s*\.page\.global-search-page\s*\{[^}]*width:\s*min\(1120px,\s*calc\(100%\s*-\s*64px\)\);[^}]*padding:\s*18px\s+0\s+48px;/s,
  );
});

test("Memory Diary and Task desktop paper lists cannot fall back to native shrink-wrapped buttons", () => {
  const css = readCss();
  assert.match(css, /\.memory-page-tools[^}]*display:\s*flex/s);
  assert.match(css, /\.memory-page-tools[^}]*button[^}]*width:\s*44px/s);
  assert.match(css, /\.memory-month-card[^}]*width:\s*100%/s);
  assert.match(css, /\.memory-row[^}]*width:\s*100%/s);
  assert.match(css, /\.memory-row[^}]*border:\s*0/s);
});

test("Global Search desktop search field constrains the search icon instead of rendering a giant SVG", () => {
  const css = readCss();
  assert.match(css, /\.global-search-page[\s\S]*\.memory-page-search\s*>\s*svg[^}]*width:\s*(?:18|20)px/s);
  assert.match(css, /\.global-search-page[\s\S]*\.memory-page-search[^}]*display:\s*flex/s);
});

test("Day Space and Universe consume the available desktop content width", () => {
  const css = readCss();
  assert.match(css, /\.day-space-stage-measure[^}]*width:\s*100%/s);
  assert.match(css, /\.day-space-stage[^}]*width:\s*100%/s);
  assert.match(css, /\.universe-page[^}]*width:\s*100%/s);
  assert.match(css, /\.universe-mobile-map[^}]*width:\s*100%/s);
});
