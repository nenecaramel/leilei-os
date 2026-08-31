import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const correctionUrl = new URL("../web/src/responsive-ui-regressions.css", import.meta.url);
const mainTsx = readFileSync(new URL("../web/src/main.tsx", import.meta.url), "utf8");
const navigationCss = readFileSync(new URL("../web/src/layout/navigation-panel.css", import.meta.url), "utf8");

function readCorrectionCss() {
  assert.equal(existsSync(correctionUrl), true, "responsive-ui-regressions.css must exist");
  return readFileSync(correctionUrl, "utf8");
}

test("responsive regression fixes load after the desktop parity layer", () => {
  assert.match(
    mainTsx,
    /import "\.\/desktop-mobile-parity\.css";\s*import "\.\/responsive-ui-regressions\.css";/s,
  );
});

test("shared navigation uses one inset active/hover tile instead of a full-height background", () => {
  assert.match(navigationCss, /\.navigation-panel-nav \.nav-item\s*\{[^}]*position:\s*relative[^}]*background:\s*transparent/s);
  assert.match(navigationCss, /\.navigation-panel-nav \.nav-item::before\s*\{[^}]*inset:\s*4px\s+0[^}]*border-radius:\s*9px/s);
  assert.match(navigationCss, /\.navigation-panel-nav \.nav-item:hover\s*\{[^}]*background:\s*transparent/s);
  assert.match(navigationCss, /\.navigation-panel-nav \.nav-item:hover::before\s*\{[^}]*background:\s*var\(--navigation-panel-hover\)/s);
  assert.match(navigationCss, /\.navigation-panel-nav \.nav-item\.active::before\s*\{[^}]*background:\s*var\(--navigation-panel-active\)/s);
});

test("Task list does not expose the desktop-only reopen button in the shared list presentation", () => {
  const css = readCorrectionCss();
  assert.match(css, /\.task-page\s+\.task-row-reopen\s*\{[^}]*display:\s*none\s*!important/s);
});

test("Day Space is visible on desktop and owns the same wider content frame", () => {
  const css = readCorrectionCss();
  assert.match(css, /@media\s*\(min-width:\s*761px\)[\s\S]*\.day-space-page\s*\{[^}]*display:\s*block\s*!important[^}]*width:\s*min\(1120px,\s*calc\(100%\s*-\s*64px\)\)/s);
});

test("Universe reuses navigation geometry and only swaps the panel palette", () => {
  const css = readCorrectionCss();
  assert.match(css, /--navigation-panel-bg:\s*#0b0c12/);
  assert.match(css, /--navigation-panel-hover:\s*#171820/);
  assert.match(css, /--navigation-panel-active:\s*#22232b/);
  assert.match(css, /:has\(\.universe-page\)[\s\S]*\.navigation-panel[^}]*background:\s*var\(--navigation-panel-bg\)\s*!important/s);
  assert.doesNotMatch(css, /\.universe-page[^\n,{]*\.nav-item\s*\{[^}]*height:/s);
});

test("Universe galaxy and fit controls share one desktop control row", () => {
  const css = readCorrectionCss();
  assert.match(css, /--universe-control-row-top:\s*88px/);
  assert.match(css, /\.universe-galaxy-picker\s*\{[^}]*top:\s*var\(--universe-control-row-top\)\s*!important/s);
  assert.match(css, /\.universe-mobile-map-toolbar\s*\{[^}]*top:\s*var\(--universe-control-row-top\)\s*!important/s);
});
