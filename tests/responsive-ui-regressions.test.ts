import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { extractNativeMobileDesktopCss } from "../web/build/native-mobile-page-css";

const mainTsx = readFileSync(new URL("../web/src/main.tsx", import.meta.url), "utf8");
const navigationCss = readFileSync(new URL("../web/src/layout/navigation-panel.css", import.meta.url), "utf8");
const viteConfig = readFileSync(new URL("../web/vite.config.ts", import.meta.url), "utf8");
const geometryUrl = new URL("../web/src/native-mobile-desktop-geometry.css", import.meta.url);

function readGeometryCss() {
  assert.equal(existsSync(geometryUrl), true, "native-mobile-desktop-geometry.css must exist");
  return readFileSync(geometryUrl, "utf8");
}

test("desktop no longer loads hand-authored page imitation layers", () => {
  assert.doesNotMatch(mainTsx, /desktop-page-unification\.css/);
  assert.doesNotMatch(mainTsx, /desktop-mobile-parity\.css/);
  assert.doesNotMatch(mainTsx, /responsive-ui-regressions\.css/);
  assert.match(mainTsx, /styles\.css\?native-mobile-desktop/);
  assert.match(mainTsx, /native-mobile-desktop-geometry\.css/);
});

test("Vite derives a desktop-only layer from the accepted mobile declarations", () => {
  assert.match(viteConfig, /nativeMobilePageCssPlugin/);

  const source = `
.base { color: red; }
@media (max-width: 760px) {
  .app-shell { display: block; }
  .memory-page-header { display: grid; }
  .paper-detail-paper { transform: translateY(11px); }
}
.after { color: blue; }
`;
  const desktop = extractNativeMobileDesktopCss(source);

  assert.match(desktop, /^\/\* generated from accepted mobile presentation;/);
  assert.match(desktop, /@media \(min-width: 761px\)/);
  assert.match(desktop, /\.memory-page-header\s*\{\s*display:\s*grid/);
  assert.match(desktop, /body:has\(:is\([^)]*\.memory-page[^)]*\)\) \.paper-detail-paper/);
  assert.doesNotMatch(desktop, /\.app-shell\s*\{\s*display:\s*block/);
  assert.doesNotMatch(desktop, /\.base|\.after/);
});

test("native desktop mirror is loaded after feature CSS and before width-only geometry", () => {
  const featureIndex = mainTsx.indexOf('import "./pages/universe-home-dark-production-fixes.css";');
  const mirrorIndex = mainTsx.indexOf('import "./styles.css?native-mobile-desktop";');
  const geometryIndex = mainTsx.indexOf('import "./native-mobile-desktop-geometry.css";');
  assert.ok(featureIndex >= 0 && mirrorIndex > featureIndex);
  assert.ok(geometryIndex > mirrorIndex);
});

test("desktop geometry changes only available width and visibility, not component presentation", () => {
  const css = readGeometryCss();
  assert.match(css, /\.main-content > \.page\.memory-page:not\(\.universe-page\)/);
  assert.match(css, /width:\s*min\(1120px,\s*calc\(100%\s*-\s*64px\)\)/);
  assert.match(css, /\.day-space-page\s*\{[^}]*display:\s*block\s*!important/s);
  assert.match(css, /\.desktop-page-description[^}]*\.task-row-reopen|\.desktop-page-description,\s*\.task-row-reopen/s);
  assert.match(css, /display:\s*none\s*!important/);
  assert.doesNotMatch(css, /font-size:/);
  assert.doesNotMatch(css, /border-radius:/);
  assert.doesNotMatch(css, /box-shadow:/);
});

test("shared navigation keeps one inset tile and Universe changes palette only", () => {
  assert.match(navigationCss, /\.navigation-panel-nav \.nav-item::before\s*\{[^}]*inset:\s*4px\s+0[^}]*border-radius:\s*9px/s);
  assert.match(navigationCss, /\.navigation-panel-nav \.nav-item:hover::before\s*\{[^}]*background:\s*var\(--navigation-panel-hover\)/s);
  assert.match(navigationCss, /\.navigation-panel-nav \.nav-item\.active::before\s*\{[^}]*background:\s*var\(--navigation-panel-active\)/s);
  assert.match(navigationCss, /\.app-shell:has\(\.universe-page\) \.navigation-panel\s*\{[^}]*--navigation-panel-bg:\s*#0b0c12/s);
  assert.doesNotMatch(navigationCss, /\.app-shell:has\(\.universe-page\)[\s\S]*\.nav-item\s*\{[^}]*height:/s);
});
