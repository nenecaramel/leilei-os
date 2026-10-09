import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paperSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url),
  "utf8",
) + readFileSync(new URL("../web/src/pages/universe/DiaryProvenanceTimeline.tsx", import.meta.url), "utf8");
const relationSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseRelationPaper.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");
const mobileCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-paper-web-mobile.css", import.meta.url),
  "utf8",
);
const detailCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-detail-memory-shell.css", import.meta.url),
  "utf8",
);

test("Universe mobile editor matches the standalone Mind Universe form language", () => {
  assert.match(paperSource, /className="universe-standalone-editor"/);
  assert.match(paperSource, /新星 · 待点亮/);
  assert.match(paperSource, /点亮一颗新星/);
  for (const label of [
    "它叫什么？",
    "一句话描述",
    "此刻的理解",
    "节点性质",
    "标签",
    "它同时闪耀在哪些星系？",
  ]) {
    assert.match(paperSource, new RegExp(label.replace(/[？?]/g, "[？?]")));
  }
  assert.match(paperSource, /保存星球/);
  assert.match(paperSource, /type="number"[^>]*step="any"/);
  assert.match(paperSource, /Number\.isFinite\(membership\.weight\)/);
});

test("Universe mobile detail matches the standalone dark detail card hierarchy", () => {
  assert.match(paperSource, /className="universe-standalone-detail"/);
  assert.match(paperSource, /更新于/);
  assert.match(paperSource, /effectiveNode!\.updatedAt/);
  assert.match(paperSource, /一阶关联/);
  assert.match(paperSource, /连接另一个思想/);
  assert.match(paperSource, /调整这颗星球/);
  assert.match(paperSource, /universe-standalone-tag/);
  assert.match(paperSource, /universe-standalone-membership/);
  assert.match(paperSource, /universe-standalone-relation-chip/);
});

test("Universe mobile connection matches the standalone connection modal", () => {
  assert.match(relationSource, /className="universe-standalone-connection"/);
  assert.match(relationSource, /连接另一个思想/);
  assert.match(relationSource, /当前思想 ·/);
  assert.match(relationSource, />连接到</);
  assert.match(relationSource, /它们如何彼此影响[？?]/);
  assert.match(relationSource, /连接强度/);
  assert.match(relationSource, /建立连接/);
});

test("Universe standalone mobile styling uses the captured dark visual language only on inner pages", () => {
  assert.match(mobileCss, /@media \(max-width:\s*760px\)/);
  assert.match(mobileCss, /#101119/i);
  assert.match(mobileCss, /#090a10/i);
  assert.match(mobileCss, /#d9ff70/i);
  assert.match(mobileCss, /\.universe-standalone-editor/);
  assert.match(mobileCss, /\.universe-standalone-detail/);
  assert.match(mobileCss, /\.universe-standalone-connection/);
  assert.doesNotMatch(mobileCss, /\.universe-mobile-map\b|\.universe-map-|\.universe-page-header|\.universe-galaxy-picker/);
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

test("Universe mobile presentation keeps desktop Paper and homepage implementation intact", () => {
  assert.match(paperSource, /className="universe-node-paper-desktop"/);
  assert.match(paperSource, /bottomLeft=\{metadata\}/);
  assert.match(mobileCss, /\.universe-node-paper-desktop,\s*\.universe-relation-paper-desktop\s*\{[\s\S]*display:\s*none/);
});

test("Universe Diary provenance timeline keeps the frozen subdued geometry", () => {
  assert.match(paperSource, /universe-diary-provenance-row/);
  assert.match(paperSource, /formatDiarySourceDate/);
  assert.match(detailCss, /\.universe-diary-provenance-line[\s\S]*background:\s*#30323b/);
  assert.match(detailCss, /\.universe-diary-provenance-date[\s\S]*font-size:\s*10px/);
  assert.match(detailCss, /\.universe-diary-provenance-title[\s\S]*font-size:\s*11px/);
  assert.match(detailCss, /\.universe-diary-provenance-date[\s\S]*color:\s*#7d7f8c|\.universe-diary-provenance-link[\s\S]*color:\s*#7d7f8c/);
});
