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

test("Connection subflow closes its dialog then returns to the source detail", () => {
  assert.match(universePageSource, /setRelationEditorOpen\(true\); setEditorOpen\(false\); setPaperMode\(null\);/);
  assert.match(universePageSource, /const sourceId = relationSourceId;[\s\S]*?setRelationEditorOpen\(false\);[\s\S]*?setPaperMode\(\{ kind: "detail", nodeId: sourceId \}\);[\s\S]*?setEditorOpen\(true\);/);
});

test("Universe edit controls use Safari focus-safe computed font sizes", () => {
  assert.match(polishCss, /\.universe-standalone-editor \.universe-standalone-form-field input,[\s\S]*?font-size:\s*16px !important/);
  assert.match(polishCss, /\.universe-standalone-connection \.universe-standalone-form-field select[\s\S]*?font-size:\s*16px !important/);
  assert.match(polishCss, /\.universe-standalone-editor \.universe-standalone-weight\s*\{[\s\S]*?font-size:\s*16px !important;[\s\S]*?transform:\s*scale\(0\.75\)/);
});

test("Mobile node editor keeps recovery and removal out of the edit body and suppresses the local weight hint", () => {
  const mobileStart = nodePaperSource.indexOf("const mobileStandaloneBody");
  const detailStart = nodePaperSource.indexOf("<section className=\"universe-standalone-detail\"");
  assert.ok(mobileStart >= 0 && detailStart > mobileStart);
  const mobileEditor = nodePaperSource.slice(mobileStart, detailStart);
  assert.doesNotMatch(mobileEditor, /universe-standalone-editor-secondary-actions/);
  assert.doesNotMatch(mobileEditor, /请填写星系权重/);
  assert.match(nodePaperSource, /detailTopRight[\s\S]*?恢复上一版本[\s\S]*?让它离开宇宙/);
  assert.match(nodePaperSource, /deleteConfirmPending[\s\S]*?确认让它离开/);
  assert.match(polishCss, /\.paper-detail-paper:has\(\.universe-standalone-detail\) \.paper-detail-top-right\s*\{[\s\S]*?display:\s*flex !important/);
});

test("Universe action feedback lives on the title row, strips trailing punctuation, and expires only while visible", () => {
  assert.match(universePageSource, /<UniverseHeader\s+notice=\{notice\?\.message\}/);
  assert.match(universePageSource, /className="universe-header-notice" role="status"/);
  assert.match(universePageSource, /if \(!notice \|\| editorOpen \|\| relationEditorOpen\) return;/);
  assert.match(universePageSource, /setTimeout\([\s\S]*?3000/);
  assert.match(universePageSource, /replace\(\/\[。．.!！？\?\]\+\$\/u, ""\)/);
  assert.doesNotMatch(universePageSource, /<p className="universe-notice"/);
  assert.match(polishCss, /\.universe-page-heading\s*\{[\s\S]*?display:\s*flex/);
});

test("Day Space keeps the white mobile top-bar surface without the gray separator edge", () => {
  assert.match(polishCss, /\.app-shell:has\(\.day-space-page\) \.mobile-top-bar\s*\{[\s\S]*?min-height:\s*calc\(44px \+ env\(safe-area-inset-top, 0px\)\)/);
  assert.match(polishCss, /height:\s*calc\(44px \+ env\(safe-area-inset-top, 0px\)\)/);
  assert.match(polishCss, /background:\s*#ffffff !important/);
  assert.match(polishCss, /border-bottom:\s*0/);
  assert.doesNotMatch(polishCss, /border-bottom:\s*1px solid rgba\(0, 0, 0, 0\.08\)/);
});

test("Universe homepage background redesign is still outside this polish file", () => {
  assert.doesNotMatch(polishCss, /\.universe-page\s*\{[\s\S]*?background:/);
  assert.doesNotMatch(polishCss, /universe-toolbar/);
});
