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

test("Universe create, edit, and connection titles all lift by ten pixels from the accepted shell", () => {
  assert.match(polishCss, /\.universe-standalone-editor h2,[\s\S]*?\.universe-standalone-connection h2\s*\{[\s\S]*?margin-top:\s*5px/);
});

test("Universe connection page uses the accepted title and removes its explanatory sentence", () => {
  assert.match(relationPaperSource, /<h2>连接另一个思想<\/h2>/);
  assert.doesNotMatch(relationPaperSource, /选择另一个思想，并定义它们之间的关系。/);
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
  assert.match(polishCss, /\.universe-standalone-editor \.universe-standalone-weight\s*\{[\s\S]*?font-size:\s*16px !important;[\s\S]*?transform:\s*scale\(0\.75\);[\s\S]*?transform-origin:\s*left center/);
});

test("Galaxy percentage input keeps optical size but leaves room for the fixed percent sign", () => {
  assert.match(polishCss, /\.universe-standalone-editor \.universe-standalone-weight\s*\{[\s\S]*?padding:\s*0 4px 0 0 !important;[\s\S]*?text-align:\s*right !important;[\s\S]*?transform-origin:\s*left center/);
});

test("Mobile recovery and removal management lives in edit instead of detail", () => {
  assert.match(nodePaperSource, /const renderManagementMenu[\s\S]*?更多星球操作[\s\S]*?恢复上一版本[\s\S]*?让它离开宇宙/);
  assert.match(nodePaperSource, /renderManagementMenu\("universe-standalone-editor-management"\)/);
  assert.match(nodePaperSource, /deleteConfirmPending[\s\S]*?确认让它离开/);
  assert.match(polishCss, /\.paper-detail-paper:has\(\.universe-standalone-detail\) \.paper-detail-top-right\s*\{[\s\S]*?display:\s*none !important/);
  assert.match(polishCss, /\.universe-standalone-editor-management\s*\{[\s\S]*?position:\s*absolute/);
});

test("Create edit and connection footers match the detail footer treatment", () => {
  assert.match(polishCss, /\.universe-standalone-editor-footer,[\s\S]*?\.universe-standalone-connection-footer\s*\{[\s\S]*?justify-content:\s*space-between !important;[\s\S]*?padding-top:\s*12px !important/);
  assert.match(polishCss, /\.universe-standalone-editor-footer button,[\s\S]*?\.universe-standalone-connection-footer button\s*\{[\s\S]*?color:\s*#7d7f8c !important;[\s\S]*?font-size:\s*12px !important;[\s\S]*?font-weight:\s*400 !important/);
});

test("Universe action feedback is horizontally centered and expires after three seconds", () => {
  assert.match(universePageSource, /<UniverseHeader\s+notice=\{notice\?\.message\}/);
  assert.match(universePageSource, /className="universe-header-notice" role="status"/);
  assert.match(universePageSource, /if \(!notice \|\| editorOpen \|\| relationEditorOpen\) return;/);
  assert.match(universePageSource, /setTimeout\([\s\S]*?3000/);
  assert.match(universePageSource, /replace\(\/\[。．.!！？\?\]\+\$\/u, ""\)/);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-header-notice\s*\{[\s\S]*?left:\s*50%;[\s\S]*?transform:\s*translateX\(-50%\);[\s\S]*?text-align:\s*center/);
});

test("Ready-state placement and move guidance use the lightweight centered status treatment", () => {
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-placement-popover,[\s\S]*?\.universe-page:has\(\.universe-mobile-map\) \.universe-map-mode-hint\s*\{[\s\S]*?left:\s*50% !important;[\s\S]*?border:\s*0 !important;[\s\S]*?background:\s*transparent !important;[\s\S]*?box-shadow:\s*none !important/);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-placement-popover\s*\{[\s\S]*?animation:\s*universe-transient-status-fade 3s/);
});

test("Universe map gestures cannot select page text or trigger the iOS callout", () => {
  assert.match(polishCss, /\.universe-mobile-map,[\s\S]*?\.universe-mobile-map \*\s*\{[\s\S]*?-webkit-user-select:\s*none;[\s\S]*?user-select:\s*none;[\s\S]*?-webkit-touch-callout:\s*none/);
});

test("Day Space uses the Memory-style sticky white mobile top bar", () => {
  assert.match(polishCss, /\.app-shell:has\(\.day-space-page\) \.mobile-top-bar\s*\{[\s\S]*?position:\s*sticky !important;[\s\S]*?top:\s*0 !important;[\s\S]*?background:\s*#ffffff !important/);
  assert.match(polishCss, /border-bottom:\s*0/);
});

test("Universe homepage background redesign is still outside this polish file", () => {
  assert.doesNotMatch(polishCss, /\.universe-page\s*\{[\s\S]*?background:/);
  assert.doesNotMatch(polishCss, /universe-toolbar/);
});
