import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { toCanonicalMemberships } from "../web/src/pages/universe/UniverseNodeMetadata.js";

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

test("Universe detail paper is reading-first with lightweight connection rows", () => {
  const source = readFileSync(paperPath, "utf8");
  assert.doesNotMatch(source, /<dl>/);
  assert.doesNotMatch(source, /<dt>类型|<dt>重要性|<dt>标签|<dt>星系/);
  assert.match(source, /编辑/);
  assert.match(source, /universe-node-paper-overflow/);
  assert.match(source, /relatedNode\.title/);
  assert.match(source, /relationTypeLabel/);
  assert.match(source, /universe-node-connection-actions/);
  assert.match(source, /移除连接/);
  assert.doesNotMatch(source, /className="danger-button"/);
});

test("weighted metadata conversion preserves exact finite values and rejects pending weights", () => {
  assert.deepEqual(toCanonicalMemberships([]), []);
  assert.deepEqual(toCanonicalMemberships([{ id: "g1", weightText: "0.55" }]), [{ id: "g1", weight: 0.55 }]);
  assert.deepEqual(toCanonicalMemberships([{ id: "g1", weightText: "-2" }]), [{ id: "g1", weight: -2 }]);
  assert.equal(toCanonicalMemberships([{ id: "g1", weightText: "" }]), null);
  assert.equal(toCanonicalMemberships([{ id: "g1", weightText: "abc" }]), null);
});

test("Universe metadata editing avoids native select/fieldset matrices", () => {
  const source = readFileSync(paperPath, "utf8");
  const metadata = readFileSync(new URL("../web/src/pages/universe/UniverseNodeMetadata.tsx", import.meta.url), "utf8");
  assert.match(source, /UniverseNodeMetadata/);
  assert.doesNotMatch(metadata, /<select/);
  assert.doesNotMatch(metadata, /<fieldset/);
  assert.match(metadata, /weightText/);
  assert.doesNotMatch(metadata, /weight:\s*1(?:\.0)?/);
});

test("Universe create/edit paper uses the same content-first transparent editors", () => {
  const source = readFileSync(paperPath, "utf8");
  assert.match(source, /universe-paper-title-editor/);
  assert.match(source, /universe-paper-summary-editor/);
  assert.match(source, /universe-paper-content-editor/);
  assert.match(source, /placeholder="星球标题"/);
  assert.doesNotMatch(source, /<label[^>]*>标题/);
  assert.doesNotMatch(source, /placeholder="摘要"/);
  assert.doesNotMatch(source, /<label[^>]*>正文/);
  assert.match(source, /topRight=/);
  assert.match(source, /取消/);
  assert.match(source, /保存/);
  assert.match(source, /universe-node-connection-overflow/);
});

test("Universe metadata lives in the fixed footer and create time is captured once", () => {
  const source = readFileSync(paperPath, "utf8");
  assert.match(source, /bottomLeft=\{metadata\}/);
  assert.match(source, /createTimestampRef/);
  assert.doesNotMatch(source, /dateLabel=\{formatUniverseNodeTimestamp\(isCreate \? new Date\(\)\.toISOString\(\)/);
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
  assert.match(source, /universe-standalone-relation-target/);
  assert.match(pageSource, /UniverseRelationPaper/);
  assert.match(pageSource, /onDeleteRelation/);
  assert.match(pageSource, /onOpenRelatedNode/);
});
