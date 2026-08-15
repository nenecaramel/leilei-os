import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
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
  const galaxySource = readFileSync(new URL("../web/src/pages/universe/UniverseGalaxyPicker.tsx", import.meta.url), "utf8");
  assert.match(galaxySource, /UniverseFloatingPopover/);
  assert.doesNotMatch(galaxySource, /universe-galaxy-backdrop/);
  assert.match(polishCss, /prefers-reduced-motion/);
  assert.doesNotMatch(polishCss, /\.universe-galaxy-menu\s*\{[\s\S]*position:\s*fixed/);
  assert.match(polishCss, /\.universe-galaxy-menu\s*\{[\s\S]*position:\s*absolute/);
  assert.match(polishCss, /\.universe-page:has\(\.universe-mobile-map\)[\s\S]*width:\s*100%/);
  assert.match(polishCss, /universe-page:has\(\.universe-mobile-map\)[\s\S]*universe-galaxy-picker/);
});

test("placement instruction lives only in the anchored add popover", () => {
  assert.doesNotMatch(pageSource, /setNotice\("点击地图选择新星球的位置/);
  assert.match(pageSource, /UniverseFloatingPopover/);
  assert.match(pageSource, /点击地图选择新星球的位置/);
  const mapSource = readFileSync(componentPath, "utf8");
  assert.doesNotMatch(mapSource, /activeMode\.kind === "placing-node"[\s\S]*点一下星图/);
});

test("ready chrome keeps top-level menus centered and the galaxy menu inside the viewport", () => {
  assert.match(polishCss, /\.universe-overflow-menu button\s*\{[\s\S]*text-align:\s*center/);
  assert.match(polishCss, /\.universe-galaxy-menu\s*\{[\s\S]*left:\s*0[\s\S]*transform:\s*none/);
});

test("ready chrome computes distinct export and galaxy button alignment", () => {
  const dom = new JSDOM(`<!doctype html><style>${polishCss}</style><div class="universe-overflow-menu"><button>导出</button></div><div class="universe-galaxy-menu"><button>星系</button></div>`);
  try {
    const exportButton = dom.window.document.querySelector<HTMLButtonElement>(".universe-overflow-menu button")!;
    const galaxyButton = dom.window.document.querySelector<HTMLButtonElement>(".universe-galaxy-menu button")!;
    assert.equal(dom.window.getComputedStyle(exportButton).textAlign, "center");
    assert.equal(dom.window.getComputedStyle(galaxyButton).textAlign, "left");
  } finally {
    dom.window.close();
  }
});

test("ready star map uses a restrained pale core and lighter secondary rings", () => {
  assert.match(polishCss, /\.universe-map-planet-core\s*\{[\s\S]*opacity:\s*0\.5/);
  assert.match(polishCss, /\.universe-map-membership-ring\s*\{[\s\S]*opacity:\s*0\.28/);
  assert.match(polishCss, /\.universe-map-planet\.is-selected \.universe-map-membership-ring\s*\{[\s\S]*opacity:\s*0\.32/);
});
