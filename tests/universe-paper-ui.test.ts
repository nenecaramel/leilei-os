import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { formatUniverseNodeTimestamp } from "../web/src/pages/universe/UniverseNodePaper.js";

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
  assert.doesNotMatch(pageSource, /position:\s*pendingPosition\s*\?\?/);
  assert.match(pageSource, /请先在星图上选择新星球的位置/);
});

test("Universe paper forms use transparent, iOS-safe controls", () => {
  const css = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
  for (const selector of [".universe-node-paper-body input", ".universe-node-paper-body textarea", ".universe-node-paper-body select", ".universe-relation-paper-body input", ".universe-relation-paper-body select"]) {
    assert.match(css, new RegExp(`${selector.replace(/[.]/g, "\\.")}[^}]*border:\\s*0`));
    assert.match(css, new RegExp(`${selector.replace(/[.]/g, "\\.")}[^}]*background:\\s*transparent`));
    assert.match(css, new RegExp(`${selector.replace(/[.]/g, "\\.")}[^}]*box-shadow:\\s*none`));
    assert.match(css, new RegExp(`${selector.replace(/[.]/g, "\\.")}[^}]*font-size:\\s*16px`));
  }
});

test("Universe node papers locally opt out of rules and signature while shared papers keep defaults", () => {
  const source = readFileSync(paperPath, "utf8");
  assert.match(source, /showRules=\{false\}/);
  assert.match(source, /signature=""/);
  const dialogSource = readFileSync(new URL("../web/src/pages/PaperDetailDialog.tsx", import.meta.url), "utf8");
  assert.match(dialogSource, /showRules\??:\s*boolean/);
  assert.match(dialogSource, /showRules = true/);
});

test("Universe node timestamps use a readable local date format", () => {
  assert.equal(formatUniverseNodeTimestamp("2026-08-15T09:07:00.000Z", "UTC"), "2026.08.15 09:07");
  assert.equal(formatUniverseNodeTimestamp("not-a-date", "UTC"), "时间未知");
});

test("Galaxy entry is label-only when inactive and names the active galaxy", () => {
  const source = readFileSync(new URL("../web/src/pages/universe/UniverseGalaxyPicker.tsx", import.meta.url), "utf8");
  assert.match(source, /universe-galaxy-entry-label.*星系/);
  assert.match(source, /active \? <><span className="universe-galaxy-entry-dot"/);
  assert.doesNotMatch(source, /: <span>全部<\/span>/);
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
  assert.match(pageSource, /onDeleteRelation/);
  assert.match(pageSource, /onOpenRelatedNode/);
});
