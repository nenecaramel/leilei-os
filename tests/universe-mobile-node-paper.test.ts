import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paperSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");

test("Universe detail actions keep overflow before Edit and removal neutral", () => {
  const detailActions = paperSource.match(
    /const detailTopRight = [\s\S]*?const editTopRight =/,
  )?.[0] ?? "";

  assert.match(detailActions, /universe-node-paper-overflow[\s\S]*>编辑<\/button>/);
  assert.match(detailActions, />建立连接<[\s\S]*>恢复上一版本<[\s\S]*>移除星球</);
  assert.doesNotMatch(paperSource, /移除星球[\s\S]{0,100}(?:danger|destructive|color:\s*(?:red|#f))/i);
});

test("Universe edit controls use the web Paper buttons and Cancel returns to detail", () => {
  assert.match(paperSource, /onCancelEdit\?:\s*\(node:\s*UniverseNode\)\s*=>\s*void/);
  assert.match(
    paperSource,
    /className="tertiary-button"[\s\S]*>取消<\/button>[\s\S]*className="tertiary-button"[\s\S]*>\{saving \? "保存中…" : "保存"\}<\/button>/,
  );
  assert.match(pageSource, /onCancelEdit=\{\(node\)\s*=>\s*\{[\s\S]*setPaperMode\(\{\s*kind:\s*"detail",\s*nodeId:\s*node\.id\s*\}\)[\s\S]*setEditorOpen\(true\)/);
});

test("Universe edit save returns to the same detail paper while create still closes", () => {
  assert.match(
    pageSource,
    /if \(editingNode\) \{[\s\S]*const editedNodeId = editingNode\.id[\s\S]*setPaperMode\(\{\s*kind:\s*"detail",\s*nodeId:\s*editedNodeId\s*\}\)[\s\S]*setEditorOpen\(true\)[\s\S]*\} else \{[\s\S]*setEditorOpen\(false\)/,
  );
});

test("Universe mobile detail and create reuse the existing web Paper structure", () => {
  assert.doesNotMatch(paperSource, /universe-node-paper-mobile\.css/);
  assert.doesNotMatch(paperSource, /<details className="universe-node-paper-properties">/);
  assert.doesNotMatch(paperSource, /universe-node-paper-(?:title|summary|content|body-detail|body-edit)/);
  assert.match(paperSource, /bottomLeft=\{metadata\}/);
  assert.match(
    paperSource,
    /\{isEdit \? \([\s\S]*<div className="universe-node-paper-body">[\s\S]*\) : \([\s\S]*<div className="universe-node-paper-body">/,
  );
});
