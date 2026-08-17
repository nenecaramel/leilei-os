import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const darkCss = readFileSync(
  new URL("../web/src/pages/universe-home-dark.css", import.meta.url),
  "utf8",
);
const geometryCss = readFileSync(
  new URL("../web/src/pages/universe-mobile-final-geometry.css", import.meta.url),
  "utf8",
);
const mainTsx = readFileSync(
  new URL("../web/src/main.tsx", import.meta.url),
  "utf8",
);
const universePageTsx = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
);

test("Universe dark home uses an explicit ready-state boundary and final cascade layer", () => {
  assert.match(universePageTsx, /const homeReady = !editorOpen && !relationEditorOpen;/);
  assert.match(universePageTsx, /universe-home-ready/);
  assert.match(mainTsx, /import "\.\/pages\/universe-mobile-final-geometry\.css";\s*import "\.\/pages\/universe-home-dark\.css";/s);
  assert.match(darkCss, /\.universe-page\.universe-home-ready\s*\{[^}]*--universe-home-bg:\s*#0b0c12;/s);
  assert.match(darkCss, /body:has\(\.universe-page\.universe-home-ready\) \.mobile-top-bar/);
  assert.match(darkCss, /body:has\(\.universe-page\.universe-home-ready\) \.quick-search-panel/);
});

test("Universe dark home leaves accepted inner pages, drawer, sidebar and popup geometry outside its scope", () => {
  assert.doesNotMatch(darkCss, /\.universe-standalone-(?:detail|editor|connection)/);
  assert.doesNotMatch(darkCss, /\.mobile-drawer/);
  assert.doesNotMatch(darkCss, /\.sidebar(?:\b|[\s,{])/);
  assert.doesNotMatch(darkCss, /\.universe-(?:placement-popover|overflow-menu)[^{]*\{[^}]*(?:width|height|min-height|padding)\s*:/s);
  assert.match(geometryCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-placement-popover > span,[\s\S]*?\.universe-page:has\(\.universe-mobile-map\) \.universe-overflow-menu button\s*\{[^}]*height:\s*auto !important;[^}]*min-height:\s*0 !important;[^}]*padding:\s*6px 8px !important;/s);
});

test("Universe dark map defines the approved planet relation and reference-dot hierarchy", () => {
  assert.match(darkCss, /\.universe-page\.universe-home-ready \.universe-map-planet-core/);
  assert.match(darkCss, /\.universe-page\.universe-home-ready \.universe-map-planet\.is-selected \.universe-map-planet-core/);
  assert.match(darkCss, /\.universe-page\.universe-home-ready \.universe-map-membership-ring/);
  assert.match(darkCss, /\.universe-page\.universe-home-ready \.universe-map-relation\s*\{[^}]*background:\s*#343640;/s);
  assert.match(darkCss, /\.universe-page\.universe-home-ready \.universe-map-relation\.is-emphasized\s*\{[^}]*background:\s*#676974;/s);
  assert.match(darkCss, /\.universe-page\.universe-home-ready \.universe-map-reference-dots i\s*\{[^}]*background:\s*#292a32;/s);
});

test("Universe dark overlays use the shared near-black surface without changing behavior", () => {
  assert.match(darkCss, /\.universe-page\.universe-home-ready \.universe-placement-popover,[\s\S]*?\.universe-page\.universe-home-ready \.universe-overflow-menu,[\s\S]*?\.universe-page\.universe-home-ready \.universe-galaxy-menu\s*\{[^}]*border:\s*1px solid var\(--universe-home-border\);[^}]*background:\s*var\(--universe-home-surface\);/s);
  assert.match(darkCss, /body:has\(\.universe-page\.universe-home-ready\) \.quick-search-result/);
  assert.match(darkCss, /body:has\(\.universe-page\.universe-home-ready\) \.quick-search-view-all/);
  assert.match(darkCss, /\.universe-page\.universe-home-ready \.universe-header-notice/);
});
