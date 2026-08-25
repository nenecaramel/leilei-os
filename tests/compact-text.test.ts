import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_COMPACT_TEXT_CODE_POINTS,
  createBodyMatchSnippet,
  createLeadingPreview,
} from "../src/domains/compact-text.js";

test("leading previews are capped by Unicode code points and ellipsis", () => {
  assert.equal(createLeadingPreview("蕾".repeat(10)), "蕾".repeat(10));
  const preview = createLeadingPreview("蕾".repeat(MAX_COMPACT_TEXT_CODE_POINTS + 1));
  assert.equal(Array.from(preview).length, MAX_COMPACT_TEXT_CODE_POINTS);
  assert.equal(preview, `${"蕾".repeat(MAX_COMPACT_TEXT_CODE_POINTS - 1)}…`);

  const astralPreview = createLeadingPreview("😀".repeat(MAX_COMPACT_TEXT_CODE_POINTS + 1));
  assert.equal(Array.from(astralPreview).length, MAX_COMPACT_TEXT_CODE_POINTS);
  assert.equal(astralPreview.endsWith("…"), true);
});

test("body match snippets are bounded, body-only, and preserve the match", () => {
  const content = `${"前".repeat(180)} Alpha   beta ${"后".repeat(180)}`;
  const snippet = createBodyMatchSnippet(content, "alpha beta");
  assert.ok(snippet);
  assert.equal(Array.from(snippet).length <= MAX_COMPACT_TEXT_CODE_POINTS, true);
  assert.match(snippet, /Alpha\s+beta/);
  assert.equal(createBodyMatchSnippet(content, "not present"), null);
  assert.equal(createBodyMatchSnippet("标题命中", "标题"), "标题命中");
});

test("body matching normalizes case, NFC, and flexible whitespace", () => {
  assert.ok(createBodyMatchSnippet("Cafe\u0301   notes", "CAFÉ notes"));
  assert.ok(createBodyMatchSnippet(`${"😀".repeat(140)} match`, "MATCH"));
});
