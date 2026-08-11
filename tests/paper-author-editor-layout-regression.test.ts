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

test("the production entrypoint actually loads the author/editor layout fix", () => {
  assert.match(main, /import\s+["']\.\/pages\/lg-author-editor-layout-fix\.css["'];/);
});

test("author edit trigger stays on the read-mode signature baseline", () => {
  assert.match(css, /\.paper-author-signature-trigger\s*\{[\s\S]*height:\s*24px/s);
  assert.match(css, /\.paper-author-signature-trigger\s*\{[\s\S]*min-height:\s*24px\s*!important/s);
  assert.match(css, /\.paper-author-signature-trigger::before\s*\{[\s\S]*position:\s*absolute/s);
});

test("missing author has no persistent text label in the paper chrome", () => {
  assert.match(css, /\.paper-author-signature-error\s*\{[\s\S]*display:\s*none\s*!important/s);
});

test("mobile metadata keeps 13px visual parity without transform hitbox drift", () => {
  assert.match(css, /\.memory-paper-tags[\s\S]*font-size:\s*16px\s*!important[\s\S]*zoom:\s*0\.8125/s);
  assert.match(css, /\.diary-paper-mood[\s\S]*zoom:\s*0\.8125/s);
  assert.match(css, /\.diary-paper-tags[\s\S]*zoom:\s*0\.8125/s);
  assert.match(css, /\.task-paper-tags[\s\S]*zoom:\s*0\.8125/s);
  assert.doesNotMatch(css, /transform:\s*scale\(0\.8125\)/);
});

test("metadata stays in the original bottom-left slot", () => {
  assert.match(css, /\.paper-detail-bottom-left\s*\{[\s\S]*left:\s*24px\s*!important/s);
  assert.match(css, /\.paper-detail-bottom-left\s*\{[\s\S]*right:\s*auto\s*!important/s);
});
