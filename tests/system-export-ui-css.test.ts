import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const css = fs.readFileSync(
  path.resolve("web/src/pages/system-export-ui-polish.css"),
  "utf8",
);

test("export rows mirror the real System data row geometry", () => {
  assert.match(css, /\.system-export-card\s*\{[\s\S]*?padding-bottom:\s*0;/);
  assert.match(css, /\.system-export-header\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-height:\s*60px;[\s\S]*?align-items:\s*center;[\s\S]*?padding-top:\s*0;/);
  assert.match(css, /\.system-export-action-row\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*repeat\(5, max-content\);[\s\S]*?justify-content:\s*space-between;[\s\S]*?min-height:\s*60px;[\s\S]*?margin-top:\s*0;/);
  assert.match(css, /\.system-export-action\s*\{[\s\S]*?width:\s*auto;[\s\S]*?padding:\s*4px 0;/);
  assert.match(css, /\.system-export-audit\s*\{[\s\S]*?min-height:\s*60px;[\s\S]*?margin-top:\s*0;/);
});

test("export row separators match existing System data separators", () => {
  assert.match(css, /\.system-export-action-row\s*\{[\s\S]*?border-top:\s*1px solid rgba\(0, 0, 0, 0\.08\);/);
  assert.match(css, /\.system-export-audit\s*\{[\s\S]*?border-top:\s*1px solid rgba\(0, 0, 0, 0\.08\);/);
});

test("audit control has no tap or focus selection tile", () => {
  assert.match(css, /\.system-export-audit\s*\{[\s\S]*?-webkit-tap-highlight-color:\s*transparent;/);
  assert.match(css, /\.system-export-audit:hover,[\s\S]*?\.system-export-audit:focus-within\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?outline:\s*0;/);
});