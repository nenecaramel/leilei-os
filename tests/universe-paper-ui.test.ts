import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const paperPath = new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url);
const relationPaperPath = new URL("../web/src/pages/universe/UniverseRelationPaper.tsx", import.meta.url);
const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");

test("Universe node paper uses the shared PaperDetailDialog shell", () => {
  assert.equal(existsSync(paperPath), true);
  const source = readFileSync(paperPath, "utf8");
  assert.match(source, /PaperDetailDialog/);
  assert.doesNotMatch(source, /<dialog|bottom-sheet|fullscreen/);
  assert.match(source, /summary/);
  assert.match(source, /content/);
  assert.match(source, /importance/);
  assert.match(source, /tags/);
  assert.match(source, /galaxies/);
  assert.match(source, /weight/);
});

test("Universe page delegates selected node rendering to the paper without resetting the map viewport", () => {
  assert.match(pageSource, /UniverseNodePaper/);
  assert.doesNotMatch(pageSource, /className="universe-detail-card"/);
  assert.match(pageSource, /viewport/);
});

test("relation flow uses a shared paper and only edits canonical type and strength", () => {
  assert.equal(existsSync(relationPaperPath), true);
  const source = readFileSync(relationPaperPath, "utf8");
  assert.match(source, /PaperDetailDialog/);
  assert.match(source, /relationType/);
  assert.match(source, /strength/);
  assert.doesNotMatch(source, /<select[^>]+name=["']target|drag|drop/);
  assert.match(pageSource, /relation-target/);
  assert.match(pageSource, /UniverseRelationPaper/);
});
