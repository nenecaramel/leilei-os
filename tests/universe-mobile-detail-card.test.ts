import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const paperSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url),
  "utf8",
);
const mobileCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-paper-web-mobile.css", import.meta.url),
  "utf8",
);

test("Universe mobile detail uses Memory paper geometry with fixed head and actions and a scrolling body", () => {
  assert.match(paperSource, /className="universe-standalone-detail-scroll"/);
  assert.match(mobileCss, /\.paper-detail-paper:has\(\.universe-standalone-detail\)[\s\S]*width:\s*min\(665px,\s*calc\(100vw - 46px\)\)[\s\S]*height:\s*clamp\(536px,\s*calc\(78dvh - 24px\),\s*696px\)[\s\S]*transform:\s*translateY\(31px\)/);
  assert.doesNotMatch(mobileCss, /height:\s*min\(590px,\s*calc\(100dvh - 96px\)\)/);
  assert.match(mobileCss, /\.universe-standalone-detail\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/);
  assert.match(mobileCss, /\.universe-standalone-detail-scroll\s*\{[\s\S]*overflow-y:\s*auto/);
});

test("Universe mobile detail keeps the current page visible behind the floating card", () => {
  assert.match(mobileCss, /\.paper-detail-layer:has\(\.universe-standalone-detail\) \.paper-detail-veil[\s\S]*rgba\(3,\s*4,\s*9,\s*0\.5\)/);
  assert.match(mobileCss, /\.paper-detail-layer:has\(\.universe-standalone-detail\) \.paper-detail-veil[\s\S]*blur\(4px\)/);
});

test("Universe mobile detail has no square dark halo outside its rounded frame", () => {
  assert.match(mobileCss, /\.paper-detail-paper:has\(\.universe-standalone-detail\)[\s\S]*border-radius:\s*14px/);
  assert.match(mobileCss, /\.paper-detail-layer:has\(\.universe-standalone-detail\) \.universe-standalone-detail[\s\S]*border-radius:\s*14px[\s\S]*box-shadow:\s*none/);
});

test("Universe mobile detail typography matches the approved hierarchy", () => {
  assert.match(mobileCss, /\.universe-standalone-type-chip\s*\{[\s\S]*min-height:\s*28px/);
  assert.match(mobileCss, /\.universe-standalone-detail h2\s*\{[\s\S]*font-size:\s*29px[\s\S]*font-weight:\s*500/);
  assert.match(mobileCss, /\.universe-standalone-summary\s*\{[\s\S]*font-size:\s*13px/);
  assert.match(mobileCss, /\.universe-standalone-content\s*\{[\s\S]*color:\s*#c7c5cc[\s\S]*font-size:\s*16px/);
  assert.match(mobileCss, /\.universe-standalone-stats strong\s*\{[\s\S]*font-size:\s*19px[\s\S]*font-weight:\s*500/);
});

test("Universe mobile detail removes the fake revision count and compacts relation controls", () => {
  const detailStart = paperSource.indexOf('className="universe-standalone-detail"');
  const detailEnd = paperSource.indexOf("</section>", detailStart);
  const detailSource = paperSource.slice(detailStart, detailEnd);
  assert.doesNotMatch(detailSource, /认知修订/);

  assert.match(mobileCss, /\.universe-standalone-relation-chip\s*\{[\s\S]*min-height:\s*28px/);
  assert.match(mobileCss, /\.universe-standalone-relation-remove\s*\{[\s\S]*font-size:\s*12px/);
  assert.doesNotMatch(mobileCss, /\.universe-standalone-relation-remove\s*\{[^}]*border-left:/);
});

test("Universe mobile detail gives both bottom actions the same secondary color", () => {
  assert.match(mobileCss, /\.universe-standalone-detail-actions button\s*\{[\s\S]*color:\s*#777986/);
  assert.doesNotMatch(mobileCss, /\.universe-standalone-detail-actions button:last-child/);
});
