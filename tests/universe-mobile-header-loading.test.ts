import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");
const polishCss = readFileSync(new URL("../web/src/pages/universe-state-polish.css", import.meta.url), "utf8");
const homePolishCss = readFileSync(new URL("../web/src/pages/universe/universe-home-polish.css", import.meta.url), "utf8");

test("Universe mobile header returns to the shared Memory title baseline", () => {
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-mobile-map\) \.universe-page-header\s*\{[\s\S]*top:\s*13px[\s\S]*right:\s*24px[\s\S]*left:\s*24px/,
  );
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-mobile-map\) \.universe-page-tools\s*\{[\s\S]*transform:\s*translateY\(3px\)/,
  );
});

test("Universe loading mirrors the Day Space placeholder and removes orbital rings", () => {
  assert.match(pageSource, /正在读取 Universe(?:…|\.\.\.)/);
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-cosmos-loading\) \.universe-cosmos-loading::before,\s*\.universe-page:has\(\.universe-cosmos-loading\) \.universe-cosmos-loading::after\s*\{[\s\S]*display:\s*none/,
  );
  assert.match(
    homePolishCss,
    /\.universe-page:has\(\.universe-cosmos-loading\) \.universe-loading-line\s*\{[\s\S]*color:\s*#aaaaaa[\s\S]*font-size:\s*12px[\s\S]*font-weight:\s*400/,
  );
});
