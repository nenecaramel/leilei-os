import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8") + readFileSync(new URL("../web/src/pages/universe/UniversePagePresentation.tsx", import.meta.url), "utf8");
const polishCss = readFileSync(new URL("../web/src/pages/universe-state-polish.css", import.meta.url), "utf8");
const homePolishCss = readFileSync(new URL("../web/src/pages/universe/universe-home-polish.css", import.meta.url), "utf8");
const sharedStylesCss = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("Universe ready header reuses the loading-page Memory header geometry", () => {
  assert.match(
    sharedStylesCss,
    /\.memory-page\s*\{[\s\S]*padding:\s*18px 0 max\(20px, env\(safe-area-inset-bottom, 0px\)\)/,
  );
  assert.match(
    sharedStylesCss,
    /\.memory-page-header\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto[\s\S]*align-items:\s*start/,
  );
  assert.match(
    sharedStylesCss,
    /\.memory-page-heading\s*\{[\s\S]*padding-top:\s*2px/,
  );
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-mobile-map\) \.universe-page-header\s*\{[\s\S]*top:\s*18px[\s\S]*right:\s*24px[\s\S]*left:\s*24px[\s\S]*display:\s*grid\s*!important[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto[\s\S]*align-items:\s*start\s*!important/,
  );
  assert.doesNotMatch(
    homePolishCss,
    /\.universe-page:has\(\.universe-mobile-map\) \.memory-page-heading,\s*\.universe-page:has\(\.universe-mobile-map\) \.universe-page-tools\s*\{[\s\S]*height:\s*34px/,
  );
});

test("Universe mobile controls share the same visual page-edge inset", () => {
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-mobile-map\) \.universe-galaxy-picker\s*\{[\s\S]*left:\s*24px/,
  );
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-mobile-map\) \.universe-mobile-map-toolbar\s*\{[\s\S]*right:\s*24px/,
  );
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-mobile-map\) \.universe-page-tools\s*\{[\s\S]*transform:\s*translateY\(-3px\)/,
  );
  assert.doesNotMatch(
    homePolishCss,
    /\.universe-page:has\(\.universe-mobile-map\) \.universe-page-tools\s*\{[\s\S]*translate\(8px/,
  );
});

test("Universe loading mirrors the Day Space placeholder and removes orbital rings", () => {
  assert.match(pageSource, /Reading\.\.\./);
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-cosmos-loading\) \.universe-cosmos-loading::before,\s*\.universe-page:has\(\.universe-cosmos-loading\) \.universe-cosmos-loading::after\s*\{[\s\S]*display:\s*none/,
  );
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-cosmos-loading\) \.universe-loading-line\s*\{[\s\S]*color:\s*#aaaaaa[\s\S]*font-size:\s*12px[\s\S]*font-weight:\s*400/,
  );
});
