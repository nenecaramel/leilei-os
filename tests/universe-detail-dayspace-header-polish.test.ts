import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const polishCss = readFileSync(
  new URL("../web/src/pages/universe-detail-dayspace-header-polish.css", import.meta.url),
  "utf8",
);
const shellCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-detail-memory-shell.css", import.meta.url),
  "utf8",
);
const stateCss = readFileSync(
  new URL("../web/src/pages/universe-state-polish.css", import.meta.url),
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
) + readFileSync(new URL("../web/src/pages/universe/UniversePagePresentation.tsx", import.meta.url), "utf8");

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
  assert.match(polishCss, /\.universe-standalone-editor-footer,[\s\S]*?\.universe-standalone-connection-footer\s*\{[\s\S]*?flex-direction:\s*row !important;[\s\S]*?justify-content:\s*space-between !important;[\s\S]*?margin:\s*0 !important;[\s\S]*?padding:\s*12px 0 0 !important/);
  assert.match(polishCss, /\.universe-standalone-editor-footer button,[\s\S]*?\.universe-standalone-connection-footer button\s*\{[\s\S]*?font-size:\s*12px !important;[\s\S]*?font-weight:\s*400 !important;[\s\S]*?line-height:\s*1\.35 !important/);
  assert.match(polishCss, /\.universe-standalone-connection\s*\{[\s\S]*?padding-bottom:\s*14px !important/);
});

test("All four Universe mobile pages use the detail footer action color", () => {
  assert.match(shellCss, /\.universe-standalone-detail-actions button\s*\{\s*color:\s*#7d7f8c;/);
  assert.match(polishCss, /\.universe-standalone-detail-actions button,[\s\S]*?\.universe-standalone-editor-footer button,[\s\S]*?\.universe-standalone-connection-footer button,[\s\S]*?\.universe-standalone-editor-footer button:disabled,[\s\S]*?\.universe-standalone-connection-footer button:disabled\s*\{[\s\S]*?color:\s*#7d7f8c !important/);
});

test("Export popover uses the same vertical and horizontal text inset as placement popover", () => {
  assert.match(stateCss, /\.universe-floating-popover\s*\{[\s\S]*?padding:\s*5px/);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-placement-popover > span\s*\{[\s\S]*?padding:\s*6px 8px/);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-overflow-menu\s*\{[\s\S]*?padding:\s*5px !important;[\s\S]*?font-size:\s*12px !important;[\s\S]*?line-height:\s*1\.35 !important/);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-overflow-menu button\s*\{[\s\S]*?min-height:\s*0 !important;[\s\S]*?padding:\s*6px 8px !important;[\s\S]*?font-size:\s*12px !important;[\s\S]*?line-height:\s*1\.35 !important/);
});

test("Universe action feedback is viewport-centered and expires after three seconds", () => {
  assert.match(universePageSource, /<UniverseHeader\s+notice=\{notice\?\.message\}/);
  assert.match(universePageSource, /className="universe-header-notice" role="status"/);
  assert.match(universePageSource, /if \(!notice \|\| editorOpen \|\| relationEditorOpen\) return;/);
  assert.match(universePageSource, /setTimeout\([\s\S]*?3000/);
  assert.match(universePageSource, /replace\(\/\[。．.!！？\?\]\+\$\/u, ""\)/);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-header-notice\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?left:\s*50vw/);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-header-notice\s*\{[\s\S]*?text-align:\s*center;[\s\S]*?transform:\s*translateX\(-50%\)/);
});

test("Add-planet placement guidance stays visible, framed, and shifts inward from the right edge", () => {
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-placement-popover\s*\{[\s\S]*?position:\s*absolute !important;[\s\S]*?right:\s*0 !important;[\s\S]*?left:\s*auto !important;[\s\S]*?max-width:\s*calc\(100vw - 32px\) !important;[\s\S]*?border:\s*1px solid #e7e7e7 !important;[\s\S]*?background:\s*#ffffff !important;[\s\S]*?box-shadow:\s*0 6px 18px rgba\(0, 0, 0, 0\.07\) !important;[\s\S]*?transform:\s*none !important;[\s\S]*?animation:\s*none !important/);
  assert.doesNotMatch(polishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-placement-popover\s*\{[^}]*universe-transient-status-fade/);
});

test("Universe map gestures cannot select page text or trigger the iOS callout", () => {
  assert.match(polishCss, /\.universe-mobile-map,[\s\S]*?\.universe-mobile-map \*\s*\{[\s\S]*?-webkit-user-select:\s*none;[\s\S]*?user-select:\s*none;[\s\S]*?-webkit-touch-callout:\s*none/);
});

test("Day Space uses the Memory-style sticky white mobile top bar above its content", () => {
  assert.match(polishCss, /\.app-shell:has\(\.day-space-page\) \.mobile-top-bar\s*\{[\s\S]*?position:\s*sticky !important;[\s\S]*?z-index:\s*40 !important;[\s\S]*?top:\s*0 !important;[\s\S]*?border-bottom:\s*0 !important;[\s\S]*?background:\s*#ffffff !important/);
});

test("Create and edit native select arrows use the same dark color scheme as connection selects", () => {
  assert.match(shellCss, /\.universe-standalone-connection \.universe-standalone-form-field select\s*\{[\s\S]*?color-scheme:\s*dark/);
  assert.match(polishCss, /\.universe-standalone-editor \.universe-standalone-form-field select\s*\{[\s\S]*?color-scheme:\s*dark/);
  assert.match(polishCss, /\.universe-standalone-editor \.universe-standalone-form-field input,[\s\S]*?\.universe-standalone-editor \.universe-standalone-form-field select,[\s\S]*?font-size:\s*16px !important/);
});

test("Universe homepage background redesign is still outside this polish file", () => {
  assert.doesNotMatch(polishCss, /\.universe-page\s*\{[\s\S]*?background:/);
  assert.doesNotMatch(polishCss, /universe-toolbar/);
});
