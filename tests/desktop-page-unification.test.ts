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

function assertSingleDesktopMediaBlock(css: string) {
  const mediaStart = css.match(/^\s*@media\s*\(min-width:\s*761px\)\s*\{/);
  assert.ok(mediaStart, "stylesheet must start with the desktop media block");
  const openingBrace = mediaStart[0].lastIndexOf("{");
  let depth = 0;
  let closingBrace = -1;
  for (let index = openingBrace; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        closingBrace = index;
        break;
      }
    }
  }
  assert.notEqual(closingBrace, -1, "desktop media block must be closed");
  assert.equal(css.slice(closingBrace + 1).trim(), "", "all CSS rules must stay inside the desktop media block");
}

test("desktop page unification stylesheet is imported after navigation panel styles", () => {
  assert.match(
    mainTsx,
    /import "\.\/layout\/navigation-panel\.css";\s*import "\.\/desktop-page-unification\.css";/s,
  );
});

test("desktop page unification stays scoped to target pages and desktop", () => {
  const css = readDesktopPageCss();
  assertSingleDesktopMediaBlock(css);
  assert.match(css, /\.memory-page/);
  assert.match(css, /\.diary-page/);
  assert.match(css, /\.task-page/);
  assert.match(css, /\.day-space-page/);
  assert.match(css, /\.global-search-page/);
  assert.doesNotMatch(css, /\.universe-|\.sidebar|\.navigation-panel/);
  assert.doesNotMatch(css, /@media\s*\(max-width/);
  assert.doesNotMatch(css, /\.app-shell|\.mobile-(?:drawer|top-bar|menu|search)/);
});
