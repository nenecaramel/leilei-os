import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const desktopPageCssUrl = new URL(
  "../web/src/desktop-page-unification.css",
  import.meta.url,
);
const mainTsx = readFileSync(
  new URL("../web/src/main.tsx", import.meta.url),
  "utf8",
);

function readDesktopPageCss() {
  assert.equal(
    existsSync(desktopPageCssUrl),
    true,
    "desktop-page-unification.css must exist",
  );
  return readFileSync(desktopPageCssUrl, "utf8");
}

test("desktop page unification stylesheet is imported after navigation panel styles", () => {
  assert.match(
    mainTsx,
    /import "\.\/layout\/navigation-panel\.css";\s*import "\.\/desktop-page-unification\.css";/s,
  );
});

test("desktop page unification stays scoped to target pages and desktop", () => {
  const css = readDesktopPageCss();
  assert.match(css, /^\s*@media\s*\(min-width:\s*761px\)/);
  assert.match(css, /\.memory-page/);
  assert.match(css, /\.diary-page/);
  assert.match(css, /\.task-page/);
  assert.match(css, /\.day-space-page/);
  assert.match(css, /\.global-search-page/);
  assert.doesNotMatch(css, /\.universe-|\.sidebar|\.navigation-panel/);
  assert.doesNotMatch(css, /@media\s*\(max-width/);
  assert.doesNotMatch(css, /\.app-shell|\.mobile-(?:drawer|top-bar|menu|search)/);
});
