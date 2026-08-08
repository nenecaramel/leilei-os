import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Diary mobile additions keep paper fields direct and date text interactive", async () => {
  const css = await readFile(
    new URL("../web/src/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /\/\* Diary mobile redesign \*\//);
  assert.match(css, /\.diary-date-popover/);
  assert.match(css, /\.diary-text-popover/);
  assert.match(css, /\.diary-paper-date-editor input\[type="date"\]/);
  assert.match(
    css,
    /\.paper-detail-paper\[id\^="diary-"\][\s\S]*background:\s*transparent/,
  );
  assert.match(css, /\.diary-paper-metadata/);
  assert.match(
    css,
    /\.diary-paper-mood,[\s\S]*width:\s*auto;[\s\S]*max-width:\s*min\(120px, 28vw\)/,
  );
  assert.doesNotMatch(
    css,
    /\.diary-paper-mood,\s*\n\s*\.diary-paper-tags\s*\{\s*\n\s*width:\s*min\(120px, 28vw\)/,
  );
});
