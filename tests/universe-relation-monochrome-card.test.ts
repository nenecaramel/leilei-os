import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const relationPaper = readFileSync(
  new URL("../web/src/pages/universe/UniverseRelationPaper.tsx", import.meta.url),
  "utf8",
);
const shellCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-detail-memory-shell.css", import.meta.url),
  "utf8",
);

test("mobile relation card uses the approved lightweight content hierarchy", () => {
  assert.match(relationPaper, /当前思想 · \{source\.title\}/);
  assert.match(relationPaper, /让两个思想相遇/);
  assert.match(relationPaper, /选择另一个思想，并定义它们之间的关系。/);
  assert.doesNotMatch(relationPaper, /universe-standalone-eyebrow/);
  assert.doesNotMatch(relationPaper, /universe-standalone-close/);
});

test("relation behavior remains target-selectable and save-safe", () => {
  assert.match(relationPaper, /nodes\.filter\(\(node\) => node\.id !== source\.id\)/);
  assert.match(relationPaper, /value=\{selectedTargetId\}/);
  assert.match(relationPaper, /disabled=\{saving \|\| !target\}/);
  assert.match(
    relationPaper,
    /onSave\(\{ source: source\.id, target: target\.id, relationType, strength \}\)/,
  );
});

test("relation outer shell exactly mirrors the accepted detail-card geometry", () => {
  assert.match(
    shellCss,
    /\.paper-detail-paper:has\(\.universe-standalone-connection\)\s*\{[\s\S]*?width:\s*min\(665px, calc\(100vw - 46px\)\)[\s\S]*?height:\s*clamp\(506px, calc\(78dvh - 54px\), 666px\)[\s\S]*?border-radius:\s*14px[\s\S]*?transform:\s*translateY\(16px\)/,
  );
  assert.match(
    shellCss,
    /\.paper-detail-layer:has\(\.universe-standalone-connection\) \.paper-detail-veil\s*\{[\s\S]*?rgba\(3, 4, 9, 0\.5\)[\s\S]*?blur\(4px\)/,
  );
  assert.match(
    shellCss,
    /@media \(max-width: 760px\) and \(max-height: 680px\)[\s\S]*?\.paper-detail-paper:has\(\.universe-standalone-connection\)\s*\{[\s\S]*?height:\s*calc\(100dvh - 50px\)/,
  );
});

test("relation controls and footer use the approved monochrome hierarchy", () => {
  assert.match(shellCss, /\.universe-standalone-connection\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto[\s\S]*?padding:\s*16px 20px 14px/);
  assert.match(shellCss, /\.universe-standalone-connection-context\s*\{[\s\S]*?font-size:\s*12px[\s\S]*?color:\s*#7d7f8c/);
  assert.match(shellCss, /\.universe-standalone-connection h2\s*\{[\s\S]*?font-size:\s*24px[\s\S]*?font-weight:\s*500[\s\S]*?color:\s*#f5f2e9/);
  assert.match(shellCss, /\.universe-standalone-connection-intro\s*\{[\s\S]*?font-size:\s*13px[\s\S]*?color:\s*#7d7f8c/);
  assert.match(shellCss, /\.universe-standalone-connection \.universe-standalone-form-field select\s*\{[\s\S]*?min-height:\s*44px[\s\S]*?border:\s*1px solid #343640[\s\S]*?border-radius:\s*10px[\s\S]*?color:\s*#d7d5d0[\s\S]*?background:\s*#101119[\s\S]*?font-size:\s*15px/);
  assert.match(shellCss, /\.universe-standalone-connection \.universe-standalone-strength-label strong\s*\{[\s\S]*?font-size:\s*15px[\s\S]*?color:\s*#f5f2e9/);
  assert.match(shellCss, /\.universe-standalone-connection-footer\s*\{[\s\S]*?border-top:\s*0/);
  assert.match(shellCss, /\.universe-standalone-connection \.universe-standalone-cancel\s*\{[\s\S]*?color:\s*#7d7f8c/);
  assert.match(shellCss, /\.universe-standalone-connection \.universe-standalone-primary\s*\{[\s\S]*?color:\s*#f5f2e9/);
  assert.match(shellCss, /\.universe-standalone-connection \.universe-standalone-primary:disabled\s*\{[\s\S]*?color:\s*#555763/);
  assert.doesNotMatch(shellCss, /#d9ff70/i);
});
