import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NAV_GROUPS,
  NAV_ITEMS,
} from "../web/src/layout/NavigationGroups.js";

const appSource = readFileSync(
  new URL("../web/src/App.tsx", import.meta.url),
  "utf8",
);
const navigationSource = readFileSync(
  new URL("../web/src/layout/NavigationGroups.tsx", import.meta.url),
  "utf8",
);
const drawerSource = readFileSync(
  new URL("../web/src/layout/MobileNavigationDrawer.tsx", import.meta.url),
  "utf8",
);
const routeScrollSource = readFileSync(
  new URL("../web/src/layout/RouteScrollManager.tsx", import.meta.url),
  "utf8",
);

const EXPECTED_SYSTEM_ENTRIES = [
  ["Account", "/system/account"],
  ["Connections", "/system/connections"],
  ["Data", "/system/data"],
  ["Activity", "/system/activity"],
  ["About", "/system/about"],
] as const;

test("System navigation exposes exactly the five approved modules", () => {
  const system = NAV_GROUPS.find((group) => group.label === "System");
  assert.ok(system);

  assert.deepEqual(
    system.entries.map((entry) => [entry.label, entry.to]),
    EXPECTED_SYSTEM_ENTRIES,
  );

  assert.equal(NAV_ITEMS.length, 12);
  assert.doesNotMatch(
    navigationSource,
    /includeSecondarySystemItems|General|Appearance|Data & Backup/,
  );
  assert.doesNotMatch(drawerSource, /includeSecondarySystemItems/);
});

test("System routes register all five pages and preserve legacy redirects", () => {
  for (const [, route] of EXPECTED_SYSTEM_ENTRIES) {
    const relative = route.slice(1).replace("/", "\\/");
    assert.match(appSource, new RegExp(`path="${relative}"`));
  }

  assert.match(
    appSource,
    /path="system"[\s\S]*?<Navigate[\s\S]*?to="\/system\/account"[\s\S]*?replace/,
  );
  assert.match(
    appSource,
    /path="settings"[\s\S]*?<Navigate[\s\S]*?to="\/system\/account"[\s\S]*?replace/,
  );
  assert.doesNotMatch(appSource, /<SettingsPage|from "\.\/pages\/SettingsPage"/);
});

test("route scroll manager treats every System page as a top-level destination", () => {
  for (const [, route] of EXPECTED_SYSTEM_ENTRIES) {
    assert.match(routeScrollSource, new RegExp(`"${route.replace("/", "\\/")}"`));
  }
  assert.match(routeScrollSource, /"\/settings"/);
});
