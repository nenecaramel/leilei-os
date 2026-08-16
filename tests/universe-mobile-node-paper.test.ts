import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paperSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");
const mobileWebCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-paper-web-mobile.css", import.meta.url),
  "utf8",
);

test("Universe mobile detail restores the original web detail-card UI", () => {
  assert.match(paperSource, /className="universe-node-original-web-mobile"/);
  assert.match(paperSource, /className="universe-detail-card"/);
  assert.match(paperSource, /className="eyebrow">\{effectiveNode!\.type\}<\/p>/);
  assert.match(paperSource, /<h2>\{effectiveNode!\.title\}<\/h2>/);
  assert.match(paperSource, />关闭<\/button>/);
  assert.match(paperSource, />调整轨道<\/button>/);
  assert.match(paperSource, />建立连接<\/button>/);
  assert.match(paperSource, />恢复上一版本<\/button>/);
  assert.match(paperSource, />移除星球<\/button>/);
  assert.match(paperSource, /className="universe-relation-list"/);
  assert.doesNotMatch(paperSource, /className="danger-button"[^>]*>移除星球/);
});

test("Universe mobile create and edit restore the original web node-editor form", () => {
  assert.match(paperSource, /className="universe-node-editor"/);
  assert.match(paperSource, /\{isCreate \? "NEW STAR" : "ADJUST ORBIT"\}/);
  assert.match(paperSource, /\{isCreate \? "点亮一颗新星" : "调整这颗星球"\}/);
  for (const label of ["标题", "摘要", "正文", "类型", "重要性", "标签"]) {
    assert.match(paperSource, new RegExp(`<label>${label}`));
  }
  assert.match(paperSource, /<legend>星系成员与权重<\/legend>/);
  assert.match(paperSource, /type="number"[^>]*step="any"/);
  assert.match(paperSource, /Number\.isFinite\(membership\.weight\)/);
  assert.match(paperSource, />\{saving \? "保存中…" : "保存"\}<\/button>/);
});

test("Universe edit Cancel returns to the same detail while create Cancel closes", () => {
  assert.match(paperSource, /onCancelEdit\?:\s*\(node:\s*UniverseNode\)\s*=>\s*void/);
  assert.match(
    paperSource,
    /if \(isCreate \|\| !effectiveNode \|\| !onCancelEdit\) \{[\s\S]*onRequestClose\(\)[\s\S]*return;[\s\S]*\}[\s\S]*onCancelEdit\(effectiveNode\)/,
  );
  assert.match(pageSource, /onCancelEdit=\{\(node\)\s*=>\s*\{[\s\S]*setPaperMode\(\{\s*kind:\s*"detail",\s*nodeId:\s*node\.id\s*\}\)[\s\S]*setEditorOpen\(true\)/);
});

test("Universe edit save returns to the same detail paper while create still closes", () => {
  assert.match(
    pageSource,
    /if \(editingNode\) \{[\s\S]*const editedNodeId = editingNode\.id[\s\S]*setPaperMode\(\{\s*kind:\s*"detail",\s*nodeId:\s*editedNodeId\s*\}\)[\s\S]*setEditorOpen\(true\)[\s\S]*\} else \{[\s\S]*setEditorOpen\(false\)/,
  );
});

test("Universe mobile original-web presentation does not change desktop or the home map", () => {
  assert.match(paperSource, /import "\.\/universe-node-paper-web-mobile\.css";/);
  assert.match(paperSource, /className="universe-node-paper-desktop"/);
  assert.match(paperSource, /bottomLeft=\{metadata\}/);
  assert.match(mobileWebCss, /\.universe-node-original-web-mobile\s*\{[\s\S]*display:\s*none/);
  assert.match(mobileWebCss, /@media \(max-width:\s*760px\)/);
  assert.match(mobileWebCss, /\.universe-node-paper-desktop\s*\{[\s\S]*display:\s*none/);
  assert.match(mobileWebCss, /\.universe-node-original-web-mobile\s*\{[\s\S]*display:\s*block/);
  assert.match(
    mobileWebCss,
    /\.paper-detail-paper:has\(\.universe-node-original-web-mobile\)[\s\S]*background:\s*transparent/,
  );
  assert.match(mobileWebCss, /\.paper-detail-paper:has\(\.universe-node-original-web-mobile\) \.paper-detail-scroll/);
  assert.doesNotMatch(mobileWebCss, /\.universe-mobile-map\b|\.universe-map-|\.universe-page-header|\.universe-galaxy-picker/);
});
