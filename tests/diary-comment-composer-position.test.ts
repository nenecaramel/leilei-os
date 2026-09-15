import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../web/src/pages/DiaryComments.tsx", import.meta.url),
  "utf8",
);

test("Diary comment composer stays above the comment list", () => {
  const composer = source.indexOf('className="diary-comment-create-trigger"');
  const list = source.indexOf('className="diary-comment-list"');

  assert.ok(composer >= 0);
  assert.ok(list >= 0);
  assert.ok(composer < list);
});
