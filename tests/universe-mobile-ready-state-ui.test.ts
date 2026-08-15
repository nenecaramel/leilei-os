import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const componentPath = new URL("../web/src/pages/universe/UniverseMobileMap.tsx", import.meta.url);
const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");
const polishCss = readFileSync(new URL("../web/src/pages/universe-state-polish.css", import.meta.url), "utf8");

test("ready state uses a mobile map renderer and fit action", () => {
  assert.equal(existsSync(componentPath), true);
  const mapSource = readFileSync(componentPath, "utf8");
  assert.match(pageSource, /UniverseMobileMap/);
  assert.match(mapSource, /查看全部/);
  assert.match(mapSource, /universe-map-presentation/);
  assert.match(mapSource, /membership\.weight/);
  assert.doesNotMatch(mapSource, /node\.type/);
});

test("ready map has no bordered engineering canvas or pill toolbar", () => {
  assert.doesNotMatch(polishCss, /\.universe-cosmos\s*\{[\s\S]*border:/);
  assert.doesNotMatch(polishCss, /\.universe-toolbar/);
});

test("ready controls use compact header actions and a non-destructive galaxy picker", () => {
  assert.doesNotMatch(pageSource, />新增<\/button>/);
  assert.match(pageSource, /＋|\+/);
  assert.match(pageSource, /···|\.\.\./);
  assert.match(pageSource, /UniverseGalaxyPicker/);
  assert.match(pageSource, /universe-overflow-menu[\s\S]*导出/);
  assert.match(pageSource, /downloadUniverseJson/);
  assert.doesNotMatch(pageSource, /universe-toolbar/);
  assert.doesNotMatch(pageSource, /UniverseCanvas|universe-detail-card|universe-node-editor/);
  assert.match(readFileSync(new URL("../web/src/pages/universe/UniverseGalaxyPicker.tsx", import.meta.url), "utf8"), /universe-galaxy-backdrop/);
  assert.match(polishCss, /prefers-reduced-motion/);
  assert.match(polishCss, /\.universe-galaxy-menu\s*\{[\s\S]*position:\s*fixed/);
});
