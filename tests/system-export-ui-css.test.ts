import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const css = fs.readFileSync(
  path.resolve("web/src/pages/system-export-ui-polish.css"),
  "utf8",
);

test("export rows use approved vertical spacing and true text spacing", () => {
  assert.match(css, /\.system-export-action-row\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(css, /\.system-export-action-row\s*\{[\s\S]*?justify-content:\s*space-between;/);
  assert.match(css, /\.system-export-action-row\s*\{[\s\S]*?margin-top:\s*18px;/);
  assert.match(css, /\.system-export-action\s*\{[\s\S]*?width:\s*auto;/);
  assert.match(css, /\.system-export-action\s*\{[\s\S]*?padding:\s*4px 0;/);
});

test("audit control has no tap or focus selection tile", () => {
  assert.match(css, /\.system-export-audit\s*\{[\s\S]*?-webkit-tap-highlight-color:\s*transparent;/);
  assert.match(css, /\.system-export-audit:hover,[\s\S]*?\.system-export-audit:focus-within\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?outline:\s*0;/);
});