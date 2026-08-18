import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile("web/src/styles.css", "utf8");
const icons = await readFile("web/src/components/icons.tsx", "utf8");

const startMarker =
  "/* leilei-final-mobile-visual-round-v3-2026-08-08:start */";
const endMarker =
  "/* leilei-final-mobile-visual-round-v3-2026-08-08:end */";

function v3Css(): string {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker);
  assert.notEqual(start, -1, "v3 CSS marker must exist");
  assert.notEqual(end, -1, "v3 CSS end marker must exist");
  return css.slice(start, end + endMarker.length);
}

test("Diary native date value is optically shifted back to center", () => {
  const block = v3Css();
  assert.match(
    block,
    /\.diary-date-popover \.native-date-input\s*\{[\s\S]*?padding-left:\s*0\s*!important;[\s\S]*?padding-right:\s*14px\s*!important;/,
  );
});

test("Memory paper top-right actions return to the shared 13px action size", () => {
  const block = v3Css();
  assert.match(
    block,
    /\.paper-detail-paper\[id\^="memory-"\] \.paper-detail-top-right[\s\S]*?font-size:\s*13px\s*!important;/,
  );
  const normalized = block.replace(/\s+/g, " ");
  assert.match(
    normalized,
    /\.paper-detail-paper\[id\^="memory-"\]\s+\.paper-detail-top-right\s+\.memory-paper-control\s*\{[\s\S]*?font-size:\s*13px\s*!important;/,
  );
});

test("Memory and Diary body editors keep 16px computed text but visually match 14px reading text", () => {
  const block = v3Css();
  assert.match(
    block,
    /\.memory-paper-content-editor,[\s\S]*?\.diary-paper-content-editor[\s\S]*?font-size:\s*16px\s*!important;[\s\S]*?transform:\s*scale\(0\.875\);[\s\S]*?width:\s*114\.285714%\s*!important;/,
  );
});

test("Memory tags and Diary mood/tags keep 16px computed text but visually match 13px metadata", () => {
  const block = v3Css();
  assert.match(
    block,
    /\.memory-paper-tags,[\s\S]*?\.diary-paper-mood,[\s\S]*?\.diary-paper-tags[\s\S]*?font-size:\s*16px\s*!important;[\s\S]*?transform:\s*scale\(0\.8125\);/,
  );
});

test("create pen receives only a subtle stroke reduction from the 1.8 icon baseline", () => {
  const block = v3Css();
  assert.match(
    block,
    /\.memory-page-create-icon\s*\{[\s\S]*?stroke-width:\s*1\.65\s*!important;/,
  );
  assert.match(icons, /strokeWidth="1\.8"/);
});
