import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
);
// 7d4c54b2 moved header markup into reusable presentation helpers.
const presentationSource = readFileSync(new URL("../web/src/pages/universe/UniversePagePresentation.tsx", import.meta.url), "utf8");
const polishCss = readFileSync(
  new URL("../web/src/pages/universe-state-polish.css", import.meta.url),
  "utf8",
);

test("Universe follows the accepted monochrome mobile UI contract", () => {
  assert.match(pageSource, /className="page memory-page universe-page"/);
  assert.match(pageSource, /<UniverseHeader/);
  assert.match(presentationSource, /className="memory-page-header universe-page-header"/);
  assert.match(presentationSource, /className="memory-page-title">Universe</);
  assert.doesNotMatch(pageSource, /eyebrow="Universe"/);
  assert.doesNotMatch(pageSource, /空间知识图谱/);
  assert.match(pageSource, /UniverseMobileMap/);

  assert.match(polishCss, /background:\s*#fff(?:fff)?/i);
  assert.match(polishCss, /color:\s*#8d8d8d/i);
  assert.doesNotMatch(polishCss, /var\(--theme(?:-|\))/);
});
