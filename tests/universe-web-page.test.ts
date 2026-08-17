import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");
const mapSource = readFileSync(new URL("../web/src/pages/universe/UniverseMobileMap.tsx", import.meta.url), "utf8");
const paperSource = readFileSync(new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url), "utf8");

test("/universe renders the spatial Universe integration rather than a placeholder", () => {
  assert.match(appSource, /import \{ UniversePage \} from "\.\/pages\/UniversePageContainer"/);
  assert.match(appSource, /path="universe"[\s\S]*element=\{<UniversePage \/>\}/);
  assert.doesNotMatch(appSource, /path="universe" element=\{<PlaceholderPage/);
  assert.match(pageSource, /UniverseMobileMap/);
  assert.match(pageSource, /LeileiOSUniverseService/);
});

test("ready state keeps the spatial map and paper structure", () => {
  assert.match(mapSource, /className="universe-mobile-map"/);
  assert.match(mapSource, /className="universe-map-world"/);
  assert.match(mapSource, /universe-map-relations/);
  assert.match(mapSource, /universe-map-reference-dots/);
  assert.match(pageSource, /UniverseNodePaper/);
  assert.match(pageSource, /UniverseRelationPaper/);
  assert.doesNotMatch(pageSource, /UniverseCanvas|universe-detail-card|universe-node-editor/);
  assert.doesNotMatch(pageSource, /className="universe-toolbar"/);
  assert.match(paperSource, /PaperDetailDialog/);
});

test("map wiring preserves explicit interaction modes and closes placement notices", () => {
  assert.match(mapSource, /activeMode\.kind/);
  assert.match(mapSource, /moving-node/);
  assert.match(mapSource, /aria-label="取消"/);
  assert.doesNotMatch(mapSource, /点一下星图，选择新星球的位置/);
  assert.match(pageSource, /onModeChange=\{\(next\) => \{/);
  assert.match(pageSource, /setNotice\(null\)/);
  assert.match(pageSource, /const cancelPlacement = \(\) =>/);
  assert.match(pageSource, /mapMode\.kind === "placing-node"/);
});

test("related-node navigation closes the paper and asks the map to reveal without reopening it", () => {
  assert.match(pageSource, /onOpenRelatedNode=\{\(nodeId\) => \{/);
  assert.match(pageSource, /setEditorOpen\(false\)/);
  assert.match(pageSource, /setPaperMode\(null\)/);
  assert.match(pageSource, /setRevealNodeId\(nodeId\)/);
  assert.match(pageSource, /revealNodeId=\{revealNodeId\}/);
  assert.doesNotMatch(pageSource, /onOpenRelatedNode=\{\(nodeId\) => \{\s*setEditorOpen\(true\)/);
});

test("the page has no local position fallback for node creation", () => {
  assert.equal(existsSync(new URL("../web/src/pages/universe/UniverseMobileMap.tsx", import.meta.url)), true);
  assert.doesNotMatch(pageSource, /\{\s*x:\s*50\s*,\s*y:\s*50\s*\}/);
});
