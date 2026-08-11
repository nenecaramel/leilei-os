import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../web/src/pages/lg-author-editor-layout-fix.css", import.meta.url),
  "utf8",
);
const main = readFileSync(
  new URL("../web/src/main.tsx", import.meta.url),
  "utf8",
);
const dialog = readFileSync(
  new URL("../web/src/pages/PaperDetailDialog.tsx", import.meta.url),
  "utf8",
);

test("the production entrypoint loads the paper acceptance overrides", () => {
  assert.match(main, /import\s+["']\.\/pages\/lg-author-editor-layout-fix\.css["'];/);
});

test("author edit trigger stays on the read-mode signature baseline", () => {
  assert.match(css, /\.paper-author-signature-trigger\s*\{[\s\S]*height:\s*24px/s);
  assert.match(css, /\.paper-author-signature-trigger\s*\{[\s\S]*min-height:\s*24px\s*!important/s);
  assert.match(css, /\.paper-author-signature-trigger::before\s*\{[\s\S]*position:\s*absolute/s);
});

test("missing author has no persistent text label in the paper chrome", () => {
  assert.match(css, /\.paper-author-signature-error\s*\{[\s\S]*display:\s*none\s*!important/s);
  assert.match(dialog, /const visibleErrorMessage = errorMessage === "请选择作者" \? null : errorMessage;/);
});

test("author integration never relocates the accepted bottom-left metadata slot", () => {
  assert.doesNotMatch(css, /\.paper-detail-bottom-left:has\(/);
});

test("Memory metadata geometry remains untouched", () => {
  assert.doesNotMatch(css, /\.memory-paper-metadata\b/);
  assert.doesNotMatch(css, /\.memory-paper-tags\b/);
});

test("Diary metadata keeps 16px Safari focus safety but scales layout and hit-testing to the 13px visual baseline", () => {
  assert.match(css, /\.diary-paper-mood,\s*\n\s*\.diary-paper-tags\s*\{[\s\S]*transform:\s*none\s*!important[\s\S]*zoom:\s*0\.8125\s*!important/s);
});

test("Task tag editor keeps the same 20px metadata baseline without transform hitbox drift", () => {
  assert.match(css, /\.task-paper-tags\s*\{[\s\S]*transform:\s*none\s*!important[\s\S]*zoom:\s*0\.8125\s*!important/s);
});
