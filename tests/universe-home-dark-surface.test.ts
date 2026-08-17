import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const darkCss = readFileSync(
  new URL("../web/src/pages/universe-home-dark.css", import.meta.url),
  "utf8",
);
const productionFixCss = readFileSync(
  new URL("../web/src/pages/universe-home-dark-production-fixes.css", import.meta.url),
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

const PAGE_SCOPE = String.raw`\.universe-page:has\(\.universe-mobile-map\)`;
const BODY_SCOPE = String.raw`body:has\(\.universe-page\)`;
const READY_BODY_SCOPE = String.raw`body:has\(\.universe-mobile-map\):not\(:has\(\.universe-standalone-detail, \.universe-standalone-editor, \.universe-standalone-connection\)\)`;
const READY_PAGE_SCOPE = String.raw`\.universe-page:has\(\.universe-mobile-map\):not\(:has\(\.universe-standalone-detail, \.universe-standalone-editor, \.universe-standalone-connection\)\)`;

test("Universe production correction layer loads last and keeps the underlying map dark while papers are open", () => {
  assert.match(mainTsx, /import "\.\/pages\/universe-home-dark\.css";\s*import "\.\/pages\/universe-home-dark-production-fixes\.css";/s);
  assert.match(productionFixCss, new RegExp(`${PAGE_SCOPE}\\s*\\{[^}]*--universe-home-bg:\\s*#0b0c12;`, "s"));
  assert.match(productionFixCss, /html:has\(\.universe-mobile-map\),[\s\S]*?\.main-content:has\(\.universe-mobile-map\)\s*\{[^}]*background:\s*#0b0c12 !important;/s);
  assert.match(productionFixCss, new RegExp(`${PAGE_SCOPE} \\.universe-mobile-map\\s*\\{[^}]*background:\\s*var\\(--universe-home-bg\\) !important;`, "s"));
  assert.doesNotMatch(productionFixCss, /:has\([^)]*:has\(/);
});

test("Universe ready-state top bar is structurally overlaid on the map instead of reserving a solid strip", () => {
  assert.match(productionFixCss, new RegExp(`${READY_BODY_SCOPE} \\.mobile-top-bar\\s*\\{[^}]*position:\\s*fixed !important;[^}]*top:\\s*0 !important;[^}]*right:\\s*0 !important;[^}]*left:\\s*0 !important;[^}]*background:\\s*transparent !important;`, "s"));
  assert.match(productionFixCss, new RegExp(`${READY_PAGE_SCOPE}\\s*\\{[^}]*height:\\s*100dvh !important;[^}]*min-height:\\s*100dvh !important;`, "s"));
  assert.match(productionFixCss, new RegExp(`${READY_PAGE_SCOPE} \\.universe-page-header\\s*\\{[^}]*top:\\s*calc\\(62px [+] env\\(safe-area-inset-top, 0px\\)\\) !important;`, "s"));
  assert.match(productionFixCss, new RegExp(`${READY_PAGE_SCOPE} \\.universe-galaxy-picker,[\\s\\S]*?${READY_PAGE_SCOPE} \\.universe-mobile-map-toolbar\\s*\\{[^}]*top:\\s*calc\\(92px [+] env\\(safe-area-inset-top, 0px\\)\\) !important;`, "s"));
});

test("Universe ready-state top bar uses the same white language as the Universe title", () => {
  assert.match(productionFixCss, new RegExp(`${READY_BODY_SCOPE} \\.mobile-top-bar\\s*\\{[^}]*color:\\s*#e8e7ec !important;[^}]*background:\\s*transparent !important;`, "s"));
  assert.match(productionFixCss, new RegExp(`${READY_BODY_SCOPE} \\.mobile-top-bar-title\\s*\\{[^}]*color:\\s*#e8e7ec !important;[^}]*opacity:\\s*1 !important;`, "s"));
  assert.match(productionFixCss, new RegExp(`${READY_BODY_SCOPE} \\.mobile-menu-button,[\\s\\S]*?${READY_BODY_SCOPE} \\.mobile-search-link\\s*\\{[^}]*color:\\s*#e8e7ec !important;[^}]*background:\\s*transparent !important;[^}]*box-shadow:\\s*none !important;[^}]*opacity:\\s*1 !important;`, "s"));
  assert.match(productionFixCss, new RegExp(`${READY_BODY_SCOPE} \\.mobile-menu-line\\s*\\{[^}]*background:\\s*currentColor !important;`, "s"));
});

test("Universe route keeps the dark mobile drawer without touching desktop sidebar", () => {
  assert.match(productionFixCss, new RegExp(`${BODY_SCOPE} \\.mobile-drawer-panel\\s*\\{[^}]*background:\\s*#0b0c12;`, "s"));
  assert.match(productionFixCss, new RegExp(`${BODY_SCOPE} \\.mobile-drawer \\.nav-item\\.active::before\\s*\\{[^}]*background:\\s*#22232b;`, "s"));
  assert.doesNotMatch(productionFixCss, /\.sidebar(?:\b|[\s,{])/);
});

test("Universe loading state is dark and keeps its existing white top bar", () => {
  assert.match(productionFixCss, /\.universe-page:has\(\.universe-cosmos-loading\)\s*\{[^}]*background:\s*#0b0c12 !important;/s);
  assert.match(productionFixCss, /\.universe-page:has\(\.universe-cosmos-loading\) \.universe-cosmos-loading\s*\{[^}]*background:\s*#0b0c12 !important;/s);
  assert.match(productionFixCss, /body:has\(\.universe-cosmos-loading\) \.mobile-top-bar\s*\{[^}]*color:\s*#e8e7ec;[^}]*background:\s*#0b0c12 !important;/s);
  assert.doesNotMatch(productionFixCss, /body:has\(\.universe-cosmos-loading\) \.mobile-top-bar\s*\{[^}]*position:\s*fixed !important;/s);
});

test("Universe home popovers keep accepted geometry while placement wins over the legacy white important rule", () => {
  assert.doesNotMatch(productionFixCss, /\.universe-(?:placement-popover|overflow-menu)[^{]*\{[^}]*(?:width|height|min-height|padding)\s*:/s);
  assert.match(geometryCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-placement-popover > span,[\s\S]*?\.universe-page:has\(\.universe-mobile-map\) \.universe-overflow-menu button\s*\{[^}]*height:\s*auto !important;[^}]*min-height:\s*0 !important;[^}]*padding:\s*6px 8px !important;/s);
  assert.match(productionFixCss, new RegExp(`${PAGE_SCOPE} \\.universe-placement-popover,[\\s\\S]*?${PAGE_SCOPE} \\.universe-overflow-menu,[\\s\\S]*?${PAGE_SCOPE} \\.universe-galaxy-menu\\s*\\{[^}]*border:\\s*1px solid var\\(--universe-home-border\\) !important;[^}]*background:\\s*var\\(--universe-home-surface\\) !important;`, "s"));
});

test("Universe map keeps soft color while slightly raising labels and topology readability", () => {
  assert.match(darkCss, /\.universe-map-planet-core/);
  assert.match(productionFixCss, new RegExp(`${PAGE_SCOPE} \\.universe-map-planet-title\\s*\\{[^}]*color:\\s*#c4c3ca;`, "s"));
  assert.match(productionFixCss, new RegExp(`${PAGE_SCOPE} \\.universe-map-relation\\s*\\{[^}]*background:\\s*#444650;`, "s"));
  assert.match(productionFixCss, new RegExp(`${PAGE_SCOPE} \\.universe-map-relation\\.is-emphasized\\s*\\{[^}]*background:\\s*#747682;`, "s"));
  assert.match(darkCss, /\.universe-map-reference-dots i/);
});

test("All transient Universe status text sits eight pixels lower while staying viewport-centered", () => {
  assert.match(productionFixCss, new RegExp(`${PAGE_SCOPE} \\.universe-header-notice,[\\s\\S]*?${PAGE_SCOPE} \\.universe-notice,[\\s\\S]*?${PAGE_SCOPE} \\.universe-map-mode-hint\\s*\\{[^}]*top:\\s*calc\\(70px [+] env\\(safe-area-inset-top, 0px\\)\\) !important;[^}]*left:\\s*50vw !important;[^}]*transform:\\s*translateX\\(-50%\\) !important;`, "s"));
});
