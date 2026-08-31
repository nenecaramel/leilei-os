import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const appShellSource = readFileSync(
  new URL("../web/src/layout/AppShell.tsx", import.meta.url),
  "utf8",
);
const mobileDrawerSource = readFileSync(
  new URL("../web/src/layout/MobileNavigationDrawer.tsx", import.meta.url),
  "utf8",
);
const navigationGroupsSource = readFileSync(
  new URL("../web/src/layout/NavigationGroups.tsx", import.meta.url),
  "utf8",
);
const desktopFoundationSource = readFileSync(
  new URL("../web/src/desktop-foundation.css", import.meta.url),
  "utf8",
);
const navigationPanelUrl = new URL(
  "../web/src/layout/NavigationPanel.tsx",
  import.meta.url,
);

test("desktop sidebar and mobile drawer use one shared navigation panel", () => {
  assert.equal(
    existsSync(navigationPanelUrl),
    true,
    "desktop and mobile navigation must have a shared NavigationPanel",
  );

  assert.match(appShellSource, /<NavigationPanel[\s\S]*?navClassName="primary-nav"/);
  assert.match(mobileDrawerSource, /<NavigationPanel[\s\S]*?titleId="mobile-drawer-title"/);
  assert.doesNotMatch(appShellSource, /className="brand-mark"|className="sidebar-footer"|<NavigationGroups/);
  assert.doesNotMatch(mobileDrawerSource, /<NavigationGroups/);
});

test("shared navigation content has no icon or Universe soon affordance", () => {
  assert.doesNotMatch(navigationGroupsSource, /<Icon\s*\/>/);
  assert.doesNotMatch(navigationGroupsSource, /<small>soon<\/small>/);
  assert.doesNotMatch(navigationGroupsSource, /label === "Universe"/);
});

test("desktop sidebar adopts the mobile drawer panel geometry without desktop-only chrome", () => {
  assert.match(
    desktopFoundationSource,
    /\.app-shell\s*\{[^}]*grid-template-columns:\s*280px minmax\(0, 1fr\)/s,
  );
  assert.match(desktopFoundationSource, /\.sidebar\s*\{[^}]*background:\s*#FFFFFE/s);
  assert.match(desktopFoundationSource, /\.sidebar\s*\{[^}]*padding:\s*calc\(env\(safe-area-inset-top, 0px\) \+ 8px\) 16px max\(18px, env\(safe-area-inset-bottom, 0px\)\)/s);
  assert.doesNotMatch(desktopFoundationSource, /\.sidebar-footer/);
  assert.doesNotMatch(desktopFoundationSource, /\.brand-mark/);
});

