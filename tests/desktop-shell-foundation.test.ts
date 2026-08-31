import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const desktopCssUrl = new URL(
  "../web/src/desktop-foundation.css",
  import.meta.url,
);
const mainTsx = readFileSync(
  new URL("../web/src/main.tsx", import.meta.url),
  "utf8",
);

function readDesktopCss() {
  assert.equal(
    existsSync(desktopCssUrl),
    true,
    "desktop-foundation.css must exist",
  );
  return readFileSync(desktopCssUrl, "utf8");
}

test("desktop foundation is imported directly after legacy global styles", () => {
  assert.match(
    mainTsx,
    /import "\.\/styles\.css";\s*import "\.\/desktop-foundation\.css";/s,
  );
});

test("desktop foundation defines neutral semantic tokens inside the desktop breakpoint", () => {
  const css = readDesktopCss();
  assert.match(css, /@media\s*\(min-width:\s*761px\)/);
  for (const token of [
    "--desktop-bg",
    "--desktop-sidebar",
    "--desktop-surface",
    "--desktop-ink",
    "--desktop-muted",
    "--desktop-line",
    "--desktop-line-strong",
    "--desktop-hover",
    "--desktop-active",
    "--desktop-focus-ring",
    "--desktop-content-max",
  ]) {
    assert.match(css, new RegExp(`${token}:`));
  }
  assert.match(
    css,
    /\.app-shell\s*\{[^}]*grid-template-columns:\s*232px minmax\(0, 1fr\)/s,
  );
  assert.match(css, /\.main-content\s*\{[^}]*background:\s*var\(--desktop-bg\)/s);
});
