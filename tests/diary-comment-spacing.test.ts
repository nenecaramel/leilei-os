import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test("Diary read content does not reserve an eight-line minimum before comments", () => {
  // bbcd0422 replaced Diary-only rules with shared ruled-paper typography.
  const sharedBlock = styles.match(/\.paper-detail-paper \.memory-paper-content\s*\{([^}]*)\}/s);
  assert.ok(sharedBlock);
  assert.doesNotMatch(sharedBlock[1], /min-height:/);
  assert.match(sharedBlock[1], /line-height:\s*30px/);
});

test("Diary editor keeps its mobile minimum while comments retain one ruled-line gap", () => {
  const editor = readFileSync(new URL("../web/src/pages/DiaryPaperEditor.tsx", import.meta.url), "utf8");
  const body = readFileSync(new URL("../web/src/pages/PaperBodyEditor.tsx", import.meta.url), "utf8");
  assert.match(editor, /<PaperBodyEditor label="日记正文"/);
  assert.match(body, /minimumHeight = 240/);
  assert.match(body, /style=\{\{ minHeight: minimumHeight \}\}/);
  assert.match(styles, /@media \(max-width: 760px\)\s*\{\s*\/\* Safari's focus-safe[\s\S]*?\.paper-detail-paper \.paper-textarea-layout > textarea\s*\{[^}]*font-size:\s*16px[^}]*line-height:\s*34\.285714px[^}]*transform:\s*scale\(0\.875\)/s);
  assert.match(
    styles,
    /\.diary-comments\s*\{[^}]*margin-top:\s*30px[^}]*padding-bottom:\s*30px/s,
  );
});


test("Diary comment composer keeps one ruled-line gap before comments", () => {
  assert.match(
    styles,
    /\.diary-comments:has\(\.diary-comment-create-trigger\) \.diary-comment-list,[\s\S]*\.diary-comments:has\(\.diary-comment-composer\) \.diary-comment-list\s*\{[^}]*margin-top:\s*30px/s,
  );
});
