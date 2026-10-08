import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nodePaper = readFileSync(
  new URL("../web/src/pages/universe/UniverseNodePaper.tsx", import.meta.url),
  "utf8",
) + readFileSync(new URL("../web/src/pages/universe/universe-node-presentation.ts", import.meta.url), "utf8");
const shellCss = readFileSync(
  new URL("../web/src/pages/universe/universe-node-detail-memory-shell.css", import.meta.url),
  "utf8",
);

test("mobile create/edit uses the approved lightweight card hierarchy", () => {
  assert.match(nodePaper, /新星 · 待点亮/);
  assert.match(nodePaper, /当前思想 · \{effectiveNode!\.title\}/);
  assert.doesNotMatch(nodePaper, /universe-standalone-eyebrow/);
  assert.doesNotMatch(nodePaper, /universe-standalone-close/);
  assert.doesNotMatch(nodePaper, /这次认知为什么改变？/);
  assert.match(nodePaper, /一句话描述 · 可选/);
  assert.match(nodePaper, /placeholder="为什么它值得留在你的宇宙？"/);
  assert.match(nodePaper, /placeholder="写下你现在怎样理解它。"/);
  assert.match(nodePaper, /placeholder="自我观察, 认知演化"/);
});

test("mobile create/edit keeps context fixed while the large title belongs to the scrollable form body", () => {
  const heading = nodePaper.match(
    /<header className="universe-standalone-editor-heading">([\s\S]*?)<\/header>/,
  )?.[1] ?? "";
  const bodyLead = nodePaper.match(
    /<div className="universe-standalone-editor-body">([\s\S]*?)<div className="universe-standalone-form-field">/,
  )?.[1] ?? "";

  assert.match(heading, /universe-standalone-editor-context/);
  assert.match(heading, /universe-standalone-editor-management/);
  assert.doesNotMatch(heading, /<h2>/);
  assert.match(
    bodyLead,
    /<h2>\{isCreate \? "点亮一颗新星" : "调整这颗星球"\}<\/h2>/,
  );
});

test("galaxy weight UI converts percentage text back to canonical decimals", () => {
  assert.match(nodePaper, /function canonicalWeightTextToPercentText\(weightText: string\)/);
  assert.match(nodePaper, /function percentWeightTextToCanonicalText\(percentText: string\)/);
  assert.match(nodePaper, /Number\(weightText\) \* 100/);
  assert.match(nodePaper, /Number\(percentText\) \/ 100/);
  assert.match(nodePaper, /className="universe-standalone-weight-suffix">%<\/span>/);
  assert.match(nodePaper, /updateMembershipWeight\(galaxy\.id, percentWeightTextToCanonicalText\(event\.currentTarget\.value\)\)/);
  assert.match(nodePaper, /toCanonicalMemberships\(memberships\)/);
});

test("mobile editor shell exactly matches accepted card geometry and compact controls", () => {
  assert.match(
    shellCss,
    /\.paper-detail-paper:has\(\.universe-standalone-editor\)\s*\{[\s\S]*?width:\s*min\(665px, calc\(100vw - 46px\)\)[\s\S]*?height:\s*clamp\(506px, calc\(78dvh - 54px\), 666px\)[\s\S]*?border-radius:\s*14px[\s\S]*?transform:\s*translateY\(16px\)/,
  );
  assert.match(shellCss, /\.universe-standalone-editor\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto[\s\S]*?padding:\s*16px 20px 14px/);
  assert.match(shellCss, /\.universe-standalone-editor \.universe-standalone-form-field input,[\s\S]*?height:\s*44px !important/);
  assert.match(shellCss, /textarea\[id\$="-summary"\][\s\S]*?height:\s*62px !important/);
  assert.match(shellCss, /textarea\[id\$="-content"\][\s\S]*?height:\s*96px !important/);
  assert.match(
    shellCss,
    /\.universe-standalone-editor-body\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?padding-top:\s*0;/,
  );
  assert.match(
    shellCss,
    /\.universe-standalone-editor-body > h2 \+ \.universe-standalone-form-field\s*\{[\s\S]*?margin-top:\s*24px;/,
  );
  assert.match(shellCss, /\.universe-standalone-editor-footer[\s\S]*?border-top:\s*0/);
  assert.match(shellCss, /\.universe-standalone-editor \.universe-standalone-primary[\s\S]*?background:\s*transparent/);
});

test("mobile editor footer keeps only text actions while edit-only destructive actions move into body", () => {
  assert.match(nodePaper, /universe-standalone-editor-management/);
  assert.match(nodePaper, /点亮星球/);
  assert.match(nodePaper, /保存星球/);
  assert.match(nodePaper, /保存中…/);
  assert.match(nodePaper, /disabled=\{saving \|\| !title\.trim\(\) \|\| canonicalMemberships === null\}/);
  assert.match(nodePaper, /onClick=\{submit\}/);
});
