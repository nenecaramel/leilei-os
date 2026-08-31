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
const appShellTsx = readFileSync(
  new URL("../web/src/layout/AppShell.tsx", import.meta.url),
  "utf8",
);
const legacyStyles = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
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
    /import "\.\/styles\.css";\s*import "\.\/desktop-foundation\.css";\s*import "\.\/layout\/navigation-panel\.css";/s,
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
    /\.app-shell\s*\{[^}]*grid-template-columns:\s*280px minmax\(0, 1fr\)/s,
  );
  assert.match(css, /\.main-content\s*\{[^}]*background:\s*var\(--desktop-bg\)/s);
});

test("desktop sidebar uses the shared text-only panel without account chrome", () => {
  assert.match(appShellTsx, /<NavigationPanel navClassName="primary-nav" \/>/);
  assert.doesNotMatch(appShellTsx, />Personal space</);
  assert.doesNotMatch(appShellTsx, /className="brand-mark"|className="sidebar-footer"/);
});

test("desktop sidebar uses flat neutral navigation without translation motion", () => {
  const css = readDesktopCss();
  assert.match(css, /\.sidebar\s*\{[^}]*background:\s*#FFFFFE/s);
  assert.doesNotMatch(css, /translateX\(/);
  assert.doesNotMatch(css, /\.brand-mark|\.sidebar-footer/);
});

test("global text selection is neutral instead of theme green", () => {
  assert.match(
    legacyStyles,
    /::selection\s*\{[^}]*color:\s*#191919;[^}]*background:\s*#d9d9d6;/s,
  );
});

test("desktop page and shared controls use the neutral vocabulary", () => {
  const css = readDesktopCss();
  assert.match(
    css,
    /\.main-content > \.page\s*\{[^}]*width:\s*min\(var\(--desktop-content-max\), calc\(100% - 64px\)\)/s,
  );
  assert.match(css, /\.page-header h1\s*\{[^}]*font-family:\s*inherit;[^}]*font-size:\s*32px/s);
  assert.match(css, /\.primary-button\s*\{[^}]*background:\s*var\(--desktop-ink\)/s);
  assert.match(css, /\.secondary-button\s*\{[^}]*border:\s*1px solid var\(--desktop-line-strong\)/s);
  assert.match(css, /input,[\s\S]*?textarea\s*\{[^}]*background:\s*var\(--desktop-surface\)/s);
  assert.match(css, /:focus\s*\{[^}]*box-shadow:\s*var\(--desktop-focus-ring\)/s);
});

test("desktop foundation cannot reach mobile navigation or Universe internals", () => {
  const css = readDesktopCss();
  assert.doesNotMatch(css, /\.mobile-(?:top-bar|drawer|menu|search)/);
  assert.doesNotMatch(css, /\.universe-/);
  assert.doesNotMatch(css, /@media\s*\(max-width/);
});

test("desktop keeps one full-text sidebar mode instead of a compact icon rail", () => {
  assert.doesNotMatch(
    legacyStyles,
    /@media\s*\(max-width:\s*980px\)[\s\S]*?grid-template-columns:\s*82px\s+minmax\(0,\s*1fr\)/,
  );
  assert.doesNotMatch(
    legacyStyles,
    /@media\s*\(max-width:\s*980px\)[\s\S]*?\.nav-item\s+span[\s\S]*?display:\s*none/s,
  );
  assert.doesNotMatch(
    legacyStyles,
    /@media\s*\(max-width:\s*980px\)[\s\S]*?\.sidebar-brand\s*>\s*div:last-child[\s\S]*?display:\s*none/s,
  );
});
