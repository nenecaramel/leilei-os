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
const authorComponent = readFileSync(
  new URL("../web/src/pages/PaperAuthorSignature.tsx", import.meta.url),
  "utf8",
);

test("the production entrypoint loads only author-specific layout overrides", () => {
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

test("author hotfix never overrides module metadata editor geometry or typography", () => {
  for (const selector of [
    "memory-paper-metadata",
    "memory-paper-tags",
    "diary-paper-metadata",
    "diary-paper-mood",
    "diary-paper-tags",
    "task-paper-metadata",
    "task-paper-tags",
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${selector}\\b`));
  }
  assert.doesNotMatch(css, /\bzoom\s*:/);
});

test("author integration contributes no DOM node to bottom-left metadata", () => {
  assert.doesNotMatch(authorComponent, /paper-author-signature-anchor/);
  assert.doesNotMatch(css, /paper-detail-bottom-left/);
  assert.match(authorComponent, /querySelector<HTMLElement>\("\.paper-detail-layer \.paper-detail-signature"\)/);
  assert.match(authorComponent, /createPortal\(signature, signatureSlot\)/);
});
