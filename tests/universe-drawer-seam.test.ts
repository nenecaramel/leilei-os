import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("web/src/pages/universe-drawer-seam.css", "utf8");
const main = readFileSync("web/src/main.tsx", "utf8");

test("Universe drawer removes the hard right seam and uses only the backdrop transition", () => {
  assert.match(css, /body:has\(\.universe-page\) \.mobile-drawer-panel\s*\{[\s\S]*border-right:\s*0\s*!important;[\s\S]*box-shadow:\s*none\s*!important;/);
  assert.match(css, /body:has\(\.universe-page\) \.mobile-drawer-backdrop\s*\{[\s\S]*backdrop-filter:\s*blur\(/);
  assert.match(css, /-webkit-backdrop-filter:\s*blur\(/);
  assert.ok(!css.includes("border-right-color"));
});

test("drawer seam correction loads after the existing Universe production fixes", () => {
  const productionFixes = main.indexOf('import "./pages/universe-home-dark-production-fixes.css";');
  const drawerFix = main.indexOf('import "./pages/universe-drawer-seam.css";');
  assert.ok(productionFixes >= 0);
  assert.ok(drawerFix > productionFixes);
});
