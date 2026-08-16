import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import test from "node:test";

const componentPath = new URL("../web/src/pages/universe/UniverseMobileMap.tsx", import.meta.url);
const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");
const polishCss = readFileSync(new URL("../web/src/pages/universe-state-polish.css", import.meta.url), "utf8");
const homePolishCss = readFileSync(new URL("../web/src/pages/universe/universe-home-polish.css", import.meta.url), "utf8");

const readyCss = `${polishCss}\n${homePolishCss}`;

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
  assert.match(readyCss, /prefers-reduced-motion/);
  assert.doesNotMatch(readyCss, /\.universe-galaxy-menu\s*\{[\s\S]*position:\s*fixed/);
});

test("placement instruction lives only in the anchored add popover", () => {
  assert.doesNotMatch(pageSource, /setNotice\("点击地图选择新星球的位置/);
  assert.match(pageSource, /UniverseFloatingPopover/);
  assert.match(pageSource, /点击地图选择新星球的位置/);
  const mapSource = readFileSync(componentPath, "utf8");
  assert.doesNotMatch(mapSource, /activeMode\.kind === "placing-node"[\s\S]*点一下星图/);
});

test("ready chrome computes distinct export and galaxy button alignment", () => {
  const dom = new JSDOM(`<!doctype html><style>${readyCss}</style><div class="universe-overflow-menu"><button>导出</button></div><div class="universe-galaxy-menu"><button>星系</button></div>`);
  try {
    const exportButton = dom.window.document.querySelector<HTMLButtonElement>(".universe-overflow-menu button")!;
    const galaxyButton = dom.window.document.querySelector<HTMLButtonElement>(".universe-galaxy-menu button")!;
    assert.equal(dom.window.getComputedStyle(exportButton).textAlign, "center");
    assert.equal(dom.window.getComputedStyle(galaxyButton).textAlign, "left");
  } finally {
    dom.window.close();
  }
});

test("mobile ready page makes the entire post-topbar viewport a map canvas", () => {
  assert.match(homePolishCss, /\.universe-page:has\(\.universe-mobile-map\)[\s\S]*height:\s*calc\(100dvh\s*-\s*\(44px/);
  assert.match(homePolishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-mobile-map\s*\{[\s\S]*position:\s*absolute[\s\S]*inset:\s*0/);
  assert.match(homePolishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-page-header\s*\{[\s\S]*position:\s*absolute/);
});

test("mobile ready chrome aligns both control rows without pressed gray boxes", () => {
  assert.match(homePolishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-page-header[\s\S]*align-items:\s*center/);
  assert.match(homePolishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-galaxy-picker[\s\S]*top:\s*48px/);
  assert.match(homePolishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-mobile-map-toolbar[\s\S]*top:\s*48px/);
  assert.match(homePolishCss, /\.universe-header-action:(?:hover|active)[\s\S]*background:\s*transparent\s*!important/);
  assert.match(homePolishCss, /\.universe-header-action\[aria-expanded="true"\][\s\S]*background:\s*transparent\s*!important/);
});

test("Universe home popovers reuse the accepted compact mobile language", () => {
  assert.match(homePolishCss, /box-shadow:\s*0 8px 24px rgba\(0, 0, 0, 0\.08\)/);
  assert.match(homePolishCss, /border-radius:\s*10px/);
  assert.match(homePolishCss, /font-size:\s*13px/);
  assert.match(homePolishCss, /min-height:\s*36px/);
  assert.match(homePolishCss, /max-width:\s*calc\(100vw - 32px\)/);
  assert.match(homePolishCss, /\.universe-galaxy-menu button\.is-active[\s\S]*border-radius:\s*7px[\s\S]*background:\s*#f2f2f2/);
  assert.match(homePolishCss, /\.universe-galaxy-menu button[\s\S]*gap:\s*8px/);
  assert.match(homePolishCss, /content:\s*"点击地图选择新星球的位置"/);
});

test("Universe home micro controls keep a compact export and shared vertical rhythm", () => {
  assert.match(homePolishCss, /--universe-home-popover-width:\s*206px/);
  assert.match(homePolishCss, /--universe-home-popover-content-height:\s*36px/);
  assert.match(homePolishCss, /\.universe-placement-popover\s*\{[\s\S]*width:\s*var\(--universe-home-popover-width\)/);
  assert.match(homePolishCss, /\.universe-overflow-menu\s*\{[\s\S]*width:\s*max-content[\s\S]*min-width:\s*78px/);
  assert.match(homePolishCss, /\.universe-overflow-menu button,\s*\.universe-placement-popover > span\s*\{[\s\S]*height:\s*var\(--universe-home-popover-content-height\)/);
  assert.match(homePolishCss, /\.universe-page:has\(\.universe-mobile-map\) \.universe-page-tools\s*\{[\s\S]*transform:\s*translateY\(3px\)/);
  assert.match(homePolishCss, /aria-label="新增星球"\][\s\S]*font-weight:\s*300/);
  assert.match(homePolishCss, /aria-label="更多 Universe 操作"\][\s\S]*letter-spacing:\s*-0\.04em/);
  assert.match(homePolishCss, /\.universe-galaxy-entry,\s*\.universe-page:has\(\.universe-mobile-map\) \.universe-map-fit\s*\{[\s\S]*color:\s*#858585[\s\S]*font-size:\s*13px[\s\S]*font-weight:\s*400/);
});

test("ready star map uses opaque pastel cores, light rings and unboxed relation labels", () => {
  assert.match(homePolishCss, /\.universe-map-planet-core\s*\{[\s\S]*color-mix\([\s\S]*opacity:\s*1[\s\S]*filter:\s*none/);
  assert.match(homePolishCss, /\.universe-map-membership-ring\s*\{[\s\S]*border-width:\s*1px/);
  assert.match(homePolishCss, /\.universe-map-relation-label\s*\{[\s\S]*background:\s*transparent/);
  assert.doesNotMatch(homePolishCss, /\.universe-map-relation-label\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255/);
});
