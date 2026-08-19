import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const daySpaceDiaryDialog = readFileSync(
  new URL("../web/src/pages/DaySpaceDiaryDialog.tsx", import.meta.url),
  "utf8",
);

test("Day Space diary editor leaves the paper signature slot to PaperAuthorSignature", () => {
  assert.match(daySpaceDiaryDialog, /signature=""/);
  assert.doesNotMatch(
    daySpaceDiaryDialog,
    /signature=\{author\s*\?\?\s*"—"\}/,
  );
  assert.match(
    daySpaceDiaryDialog,
    /<PaperAuthorSignature[\s\S]*?value=\{author\}[\s\S]*?editable=\{!saving\}/,
  );
});
