import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paperSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");
const mobileCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-paper-mobile.css", import.meta.url),
  "utf8",
);

test("Universe detail actions place overflow before Edit and keep removal neutral", () => {
  const detailActions = paperSource.match(
    /const detailTopRight = [\s\S]*?const editTopRight =/,
  )?.[0] ?? "";

  assert.match(detailActions, /universe-node-paper-overflow[\s\S]*>编辑<\/button>/);
  assert.match(detailActions, />建立连接<[\s\S]*>恢复上一版本<[\s\S]*>移除星球</);
  assert.match(
    mobileCss,
    /\.universe-node-paper-overflow-menu button\s*\{[\s\S]*color:\s*#555555/,
  );
  assert.doesNotMatch(paperSource, /移除星球[\s\S]{0,100}(?:danger|destructive|color:\s*(?:red|#f))/i);
});

test("Universe edit controls reuse Paper controls and Cancel returns to detail", () => {
  assert.match(paperSource, /onCancelEdit\?:\s*\(node:\s*UniverseNode\)\s*=>\s*void/);
  assert.match(
    paperSource,
    /className="memory-paper-control"[\s\S]*>取消<\/button>[\s\S]*<span[^>]*>·<\/span>[\s\S]*className="memory-paper-control"[\s\S]*>保存<\/button>/,
  );
  assert.match(pageSource, /onCancelEdit=\{\(node\)\s*=>\s*\{[\s\S]*setPaperMode\(\{\s*kind:\s*"detail",\s*nodeId:\s*node\.id\s*\}\)[\s\S]*setEditorOpen\(true\)/);
});

test("Universe edit save returns to the same detail paper while create still closes", () => {
  assert.match(
    pageSource,
    /if \(editingNode\) \{[\s\S]*const editedNodeId = editingNode\.id[\s\S]*setPaperMode\(\{\s*kind:\s*"detail",\s*nodeId:\s*editedNodeId\s*\}\)[\s\S]*setEditorOpen\(true\)[\s\S]*\} else \{[\s\S]*setEditorOpen\(false\)/,
  );
});

test("Universe mobile detail is reading-first with collapsible attributes at the tail", () => {
  assert.match(paperSource, /<details className="universe-node-paper-properties">[\s\S]*<summary>属性<\/summary>[\s\S]*\{metadata\}[\s\S]*<\/details>/);
  assert.match(paperSource, /bottomLeft=\{isEdit \? metadata : null\}/);
  assert.match(
    mobileCss,
    /@media \(max-width: 760px\)[\s\S]*\.universe-node-paper-properties\s*\{[\s\S]*margin-top:/,
  );
});
