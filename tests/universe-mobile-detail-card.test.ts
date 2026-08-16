import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const paperSource = readFileSync(
  new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url),
  "utf8",
);
const mobileCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-paper-web-mobile.css", import.meta.url),
  "utf8",
);
const detailShellUrl = new URL(
  "../web/src/pages/universe/universe-node-detail-memory-shell.css",
  import.meta.url,
);
const detailShellCss = existsSync(detailShellUrl)
  ? readFileSync(detailShellUrl, "utf8")
  : "";

test("Universe mobile detail keeps its top edge while moving the bottom edge up 30px", () => {
  assert.match(paperSource, /className="universe-standalone-detail-scroll"/);
  assert.match(detailShellCss, /\.paper-detail-paper:has\(\.universe-standalone-detail\)[\s\S]*width:\s*min\(665px,\s*calc\(100vw - 46px\)\)[\s\S]*height:\s*clamp\(506px,\s*calc\(78dvh - 54px\),\s*666px\)[\s\S]*transform:\s*translateY\(16px\)/);
  assert.match(detailShellCss, /@media \(max-width:\s*760px\) and \(max-height:\s*680px\)[\s\S]*height:\s*calc\(100dvh - 50px\)[\s\S]*max-height:\s*calc\(100dvh - 50px\)/);
  assert.match(mobileCss, /\.universe-standalone-detail\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/);
  assert.match(mobileCss, /\.universe-standalone-detail-scroll\s*\{[\s\S]*overflow-y:\s*auto/);
});

test("Universe mobile detail keeps the current page visible behind the floating card", () => {
  assert.match(mobileCss, /\.paper-detail-layer:has\(\.universe-standalone-detail\) \.paper-detail-veil[\s\S]*rgba\(3,\s*4,\s*9,\s*0\.5\)/);
  assert.match(mobileCss, /\.paper-detail-layer:has\(\.universe-standalone-detail\) \.paper-detail-veil[\s\S]*blur\(4px\)/);
});

test("Universe mobile detail has no square dark halo outside its rounded frame", () => {
  assert.match(detailShellCss, /\.paper-detail-paper:has\(\.universe-standalone-detail\)[\s\S]*border-radius:\s*14px/);
  assert.match(detailShellCss, /\.paper-detail-layer:has\(\.universe-standalone-detail\) \.universe-standalone-detail[\s\S]*border-radius:\s*14px[\s\S]*box-shadow:\s*none/);
});

test("Universe mobile detail typography matches the approved hierarchy", () => {
  assert.match(mobileCss, /\.universe-standalone-type-chip\s*\{[\s\S]*min-height:\s*28px/);
  assert.match(detailShellCss, /\.universe-standalone-detail h2\s*\{[\s\S]*font-size:\s*27px/);
  assert.match(mobileCss, /\.universe-standalone-summary\s*\{[\s\S]*font-size:\s*13px/);
  assert.match(detailShellCss, /\.universe-standalone-summary\s*\{[\s\S]*margin-top:\s*5px[\s\S]*color:\s*#7d7f8c/);
  assert.match(detailShellCss, /\.universe-standalone-updated\s*\{[\s\S]*font-size:\s*12px/);
  assert.match(detailShellCss, /\.universe-standalone-content\s*\{[\s\S]*color:\s*#f5f2e9/);
  assert.match(mobileCss, /\.universe-standalone-content\s*\{[\s\S]*font-size:\s*16px/);
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

test("Universe mobile detail uses one neutral gray and one warm white for text hierarchy", () => {
  assert.match(mobileCss, /\.universe-standalone-tag\s*\{[\s\S]*color:\s*#7d7f8c/);
  assert.match(detailShellCss, /\.universe-standalone-updated,[\s\S]*\.universe-standalone-detail-actions button\s*\{[\s\S]*color:\s*#7d7f8c/);
  assert.match(detailShellCss, /\.universe-standalone-stats strong\s*\{[\s\S]*color:\s*#f5f2e9/);
  assert.doesNotMatch(detailShellCss, /#c7c5cc|#777986|#737582|#656773|#5e606d|#858793/);
});
