import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(
  new URL("../web/src/pages/lg-author-editor-layout-fix.css", import.meta.url),
  "utf8",
);

test("author edit trigger keeps the signature baseline while retaining an expanded hit target", () => {
  assert.match(css, /\.paper-author-signature-trigger\s*\{[\s\S]*height:\s*24px/s);
  assert.match(css, /\.paper-author-signature-trigger::before\s*\{[\s\S]*position:\s*absolute/s);
});

test("mobile metadata inputs are not visually transformed away from their tap targets", () => {
  assert.match(css, /\.memory-paper-tags[\s\S]*transform:\s*none\s*!important/s);
  assert.match(css, /\.diary-paper-mood[\s\S]*transform:\s*none\s*!important/s);
  assert.match(css, /\.diary-paper-tags[\s\S]*transform:\s*none\s*!important/s);
  assert.match(css, /\.task-paper-tags[\s\S]*transform:\s*none\s*!important/s);
});

test("legacy bottom-left relocation override is neutralized", () => {
  assert.match(css, /\.paper-detail-bottom-left:has\(\.paper-author-signature\)[\s\S]*left:\s*24px\s*!important/s);
  assert.match(css, /\.paper-detail-bottom-left:has\(\.paper-author-signature\)[\s\S]*right:\s*auto\s*!important/s);
});
