import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const polishCss = readFileSync(
  new URL("../web/src/pages/universe-detail-dayspace-header-polish.css", import.meta.url),
  "utf8",
);
const nodePaperSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url),
  "utf8",
);
const relationPaperSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseRelationPaper.tsx", import.meta.url),
  "utf8",
);
const universePageSource = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
);

test("Universe detail keeps its title in scrolling content and lifts title plus summary", () => {
  assert.match(nodePaperSource, /universe-standalone-detail-scroll[\s\S]*?<h2>\{effectiveNode!\.title\}<\/h2>[\s\S]*?universe-standalone-summary/);
  assert.match(polishCss, /\.universe-standalone-detail-scroll > h2\s*\{[\s\S]*?position:\s*static;[\s\S]*?margin-top:\s*5px/);
  assert.match(polishCss, /\.universe-standalone-summary\s*\{[\s\S]*?margin-top:\s*4px/);
});

test("Universe create/edit and connection headings are lifted and create footer stays split left-right", () => {
  assert.match(polishCss, /\.universe-standalone-editor h2,[\s\S]*?\.universe-standalone-connection h2\s*\{[\s\S]*?margin-top:\s*14px/);
  assert.match(polishCss, /\.universe-standalone-editor-footer\s*\{[\s\S]*?flex-direction:\s*row;[\s\S]*?justify-content:\s*space-between/);
});

test("Universe connection strength thumb uses the same zero-based percentage scale as its label", () => {
  assert.match(relationPaperSource, /type="range"\s+min="0"\s+max="1"\s+step="0\.1"/);
  assert.doesNotMatch(relationPaperSource, /type="range"\s+min="0\.1"/);
});

test("Opening connection keeps the source detail mounted so cancel returns to detail", () => {
  assert.match(universePageSource, /onCreateRelation=\{\(node\) => \{[^}]*setRelationEditorOpen\(true\); \}\}/);
  assert.doesNotMatch(universePageSource, /onCreateRelation=\{\(node\) => \{[^}]*setRelationEditorOpen\(true\);[^}]*setEditorOpen\(false\)/);
  assert.match(universePageSource, /onRequestClose=\{\(\) => \{ setRelationEditorOpen\(false\); setRelationSourceId\(null\); setPaperError\(null\); setMapMode\(\{ kind: "browse" \}\); return true; \}\}/);
});

test("Day Space keeps the white mobile top-bar surface without the gray separator edge", () => {
  assert.match(polishCss, /\.app-shell:has\(\.day-space-page\) \.mobile-top-bar\s*\{[\s\S]*?min-height:\s*calc\(44px \+ env\(safe-area-inset-top, 0px\)\)/);
  assert.match(polishCss, /height:\s*calc\(44px \+ env\(safe-area-inset-top, 0px\)\)/);
  assert.match(polishCss, /background:\s*#ffffff !important/);
  assert.match(polishCss, /border-bottom:\s*0/);
  assert.doesNotMatch(polishCss, /border-bottom:\s*1px solid rgba\(0, 0, 0, 0\.08\)/);
});

test("Universe homepage floating-header redesign is not included in this polish file", () => {
  assert.doesNotMatch(polishCss, /universe-page[\s\S]*mobile-top-bar/);
  assert.doesNotMatch(polishCss, /universe-toolbar/);
});
