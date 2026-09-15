import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

test("Diary read content does not reserve an eight-line minimum before comments", () => {
  const sharedBlock = styles.match(
    /\.paper-detail-paper\[id\^="diary-"\] \.memory-paper-content,\s*\.paper-detail-paper\[id\^="diary-"\] \.diary-paper-content-editor\s*\{([^}]*)\}/s,
  );
  assert.ok(sharedBlock);
  assert.doesNotMatch(sharedBlock[1], /min-height:\s*240px/);
  assert.match(sharedBlock[1], /line-height:\s*30px/);
});

test("Diary editor keeps its mobile minimum while comments retain one ruled-line gap", () => {
  assert.match(
    styles,
    /\.paper-detail-paper\[id\^="diary-"\] \.diary-paper-content-editor\s*\{[^}]*min-height:\s*240px[^}]*font-size:\s*16px !important[^}]*line-height:\s*34\.285714px !important/s,
  );
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
