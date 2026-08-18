import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialog = readFileSync(
  new URL("../web/src/pages/PaperDetailDialog.tsx", import.meta.url),
  "utf8",
);

test("paper dialog freezes the background document instead of relying on overflow hidden", () => {
  assert.match(dialog, /const scrollY = window\.scrollY;/);
  assert.match(dialog, /body\.style\.position = "fixed";/);
  assert.match(dialog, /body\.style\.top = `-\$\{scrollY\}px`;/);
  assert.match(dialog, /body\.style\.width = "100%";/);
  assert.match(dialog, /window\.scrollTo\(scrollX, scrollY\);/);
});

test("paper focus changes do not ask Safari to scroll the document", () => {
  assert.match(dialog, /paperRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(dialog, /triggerRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
});
