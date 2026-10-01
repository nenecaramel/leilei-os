import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const oldDesktopPageCssUrl = new URL(
  "../web/src/desktop-page-unification.css",
  import.meta.url,
);
const oldParityCssUrl = new URL(
  "../web/src/desktop-mobile-parity.css",
  import.meta.url,
);
const oldRegressionCssUrl = new URL(
  "../web/src/responsive-ui-regressions.css",
  import.meta.url,
);
const geometryCssUrl = new URL(
  "../web/src/native-mobile-desktop-geometry.css",
  import.meta.url,
);
const mainTsx = readFileSync(
  new URL("../web/src/main.tsx", import.meta.url),
  "utf8",
);
const diaryPageTsx = readFileSync(
  new URL("../web/src/pages/DiaryPage.tsx", import.meta.url),
  "utf8",
);
const universePageTsx = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
);

test("hand-authored desktop page imitation stylesheets are retired", () => {
  assert.equal(existsSync(oldDesktopPageCssUrl), false);
  assert.equal(existsSync(oldParityCssUrl), false);
  assert.equal(existsSync(oldRegressionCssUrl), false);
  assert.doesNotMatch(mainTsx, /desktop-page-unification|desktop-mobile-parity|responsive-ui-regressions/);
});

test("desktop imports the native mobile presentation sources instead of a second design", () => {
  assert.match(mainTsx, /styles\.css\?native-mobile-desktop/);
  assert.match(mainTsx, /universe-mobile-final-geometry\.css\?native-mobile-desktop/);
  assert.match(mainTsx, /universe-home-dark\.css\?native-mobile-desktop/);
  assert.match(mainTsx, /universe-state-polish\.css\?native-mobile-desktop/);
  assert.match(mainTsx, /native-mobile-desktop-geometry\.css/);
});

test("the only final desktop page stylesheet is geometry-only", () => {
  assert.equal(existsSync(geometryCssUrl), true);
  const css = readFileSync(geometryCssUrl, "utf8");
  assert.match(css, /@media\s*\(min-width:\s*761px\)/);
  assert.match(css, /width:\s*min\(1120px,\s*calc\(100%\s*-\s*64px\)\)/);
  assert.match(css, /\.universe-mobile-map/);
  assert.doesNotMatch(css, /font-family:|font-size:|font-weight:|border-radius:|box-shadow:|letter-spacing:/);
});

test("Diary keeps the paper/mobile component tree as the common render", () => {
  assert.match(diaryPageTsx, /<DiaryPageHeader\b/);
  assert.match(diaryPageTsx, /<MobileDiaryRows\b/);
});

test("desktop-only explanatory copy and list reopen affordance are suppressed", () => {
  const css = readFileSync(geometryCssUrl, "utf8");
  assert.match(css, /\.desktop-page-description,\s*\.task-row-reopen\s*\{[^}]*display:\s*none\s*!important/s);
});

test("Universe uses the mobile map component for the common render", () => {
  assert.match(universePageTsx, /<UniverseMobileMap\b/);
  assert.doesNotMatch(universePageTsx, /DesktopUniverse|UniverseDesktopMap/);
});
