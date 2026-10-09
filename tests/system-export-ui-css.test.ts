import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const css = fs.readFileSync(
  path.resolve("web/src/pages/system-data-backup.css"),
  "utf8",
);

test("Data backup and restore share one System row language", () => {
  assert.match(
    css,
    /\.system-export-card,[\s\S]*?\.system-import-card\s*\{[\s\S]*?margin-top:\s*12px;/,
  );
  assert.match(
    css,
    /\.system-export-action-row\s*\{[\s\S]*?grid-template-columns:\s*max-content;[\s\S]*?min-height:\s*60px;/,
  );
  assert.match(
    css,
    /\.system-import-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto;[\s\S]*?min-height:\s*60px;/,
  );
});

test("backup and restore rows use the existing System separator", () => {
  assert.match(
    css,
    /\.system-export-action-row\s*\{[\s\S]*?border-top:\s*1px solid rgba\(0, 0, 0, 0\.08\);/,
  );
  assert.match(
    css,
    /\.system-import-row\s*\{[\s\S]*?border-top:\s*1px solid rgba\(0, 0, 0, 0\.08\);/,
  );
});
