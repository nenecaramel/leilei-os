import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const universePage = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
);
const relationPaper = readFileSync(
  new URL("../web/src/pages/universe/UniverseRelationPaper.tsx", import.meta.url),
  "utf8",
);
const mobileMap = readFileSync(
  new URL("../web/src/pages/universe/UniverseMobileMap.tsx", import.meta.url),
  "utf8",
);
const mapInteraction = readFileSync(
  new URL("../web/src/pages/universe/universe-map-interaction.ts", import.meta.url),
  "utf8",
);

test("Universe detail opens relation editor directly instead of entering map target mode", () => {
  assert.match(
    universePage,
    /onCreateRelation=\{\(node\) => \{[\s\S]*setRelationSourceId\(node\.id\)[\s\S]*setRelationEditorOpen\(true\)[\s\S]*setEditorOpen\(false\)/,
  );
  assert.doesNotMatch(universePage, /setMapMode\(\{ kind: "relation-target"/);
  assert.doesNotMatch(universePage, /onChooseRelationTarget=/);
});

test("Relation paper owns target selection and can open without a preselected target", () => {
  assert.match(relationPaper, /nodes:\s*UniverseNode\[\]/);
  assert.match(relationPaper, /const \[selectedTargetId, setSelectedTargetId\] = useState\(""\)/);
  assert.match(relationPaper, /nodes\.filter\(\(node\) => node\.id !== source\.id\)/);
  assert.match(relationPaper, /<select[^>]*value=\{selectedTargetId\}/);
  assert.match(relationPaper, /<option value="">选择另一个思想<\/option>/);
  assert.match(relationPaper, /disabled=\{saving \|\| !target\}/);
  assert.doesNotMatch(relationPaper, /if \(!source \|\| !target\) return null/);
});

test("Map no longer carries relation-target-only state or callbacks", () => {
  assert.doesNotMatch(mapInteraction, /relation-target/);
  assert.doesNotMatch(mapInteraction, /begin-relation/);
  assert.doesNotMatch(mapInteraction, /open-relation/);
  assert.doesNotMatch(mobileMap, /onChooseRelationTarget/);
  assert.doesNotMatch(mobileMap, /relation-target/);
});
