import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const protectedAppSource = readFileSync(
  new URL("../web/src/auth/ProtectedApp.tsx", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(
  new URL("../web/src/layout/AppShell.tsx", import.meta.url),
  "utf8",
);
const dashboardContainerSource = readFileSync(
  new URL("../web/src/pages/DashboardPageContainer.tsx", import.meta.url),
  "utf8",
);
const dashboardSource = readFileSync(
  new URL("../web/src/pages/DashboardPage.tsx", import.meta.url),
  "utf8",
);
const indexHtml = readFileSync(
  new URL("../web/index.html", import.meta.url),
  "utf8",
);

test("authenticated runtime no longer depends on Settings personalization", () => {
  assert.doesNotMatch(
    protectedAppSource,
    /SettingsProvider|from "\.\.\/settings\//,
  );
  assert.doesNotMatch(
    appShellSource,
    /useSettings|preferred_name|from "\.\.\/settings\//,
  );
  assert.doesNotMatch(
    dashboardContainerSource,
    /useSettings|from "\.\.\/settings\//,
  );
  assert.doesNotMatch(
    dashboardSource,
    /SettingsData|settings\??:|void settings|from "\.\.\/settings\//,
  );
});

test("auth owns the neutral theme-color helper after Settings retirement", () => {
  assert.equal(existsSync("web/src/auth/theme-color.ts"), true);
  assert.match(
    protectedAppSource,
    /from "\.\/theme-color"/,
  );
  assert.match(
    protectedAppSource,
    /syncThemeColorMeta\(document,\s*"#ffffff"\)/,
  );
});

test("initial HTML no longer prehydrates Settings or legacy theme caches", () => {
  assert.doesNotMatch(
    indexHtml,
    /leilei-os\.settings\.v1|leilei-os\.theme\.v1|--theme-page-background/,
  );
  assert.match(
    indexHtml,
    /<meta[^>]*name="theme-color"[^>]*content="#[0-9a-fA-F]{6}"[^>]*\/>/,
  );
});

test("legacy frontend Settings implementation files are removed", () => {
  for (const path of [
    "web/src/pages/SettingsPage.tsx",
    "web/src/settings/SettingsProvider.tsx",
    "web/src/settings/cache.ts",
    "web/src/settings/theme.ts",
    "web/src/settings/types.ts",
  ]) {
    assert.equal(existsSync(path), false, `${path} must be retired`);
  }
});
