import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from "../web/node_modules/react-router-dom/dist/index.mjs";
import { JSDOM } from "jsdom";
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

function RouteStateProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return React.createElement(
    "span",
    null,
    `${location.pathname}|${navigationType}`,
  );
}

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

  assert.equal(NAV_ITEMS.length, 10);
  assert.equal(NAV_ITEMS.some((entry) => entry.to === "/shared-paper"), false);
  assert.equal(NAV_ITEMS.some((entry) => entry.to === "/memory"), false);
  assert.equal(NAV_ITEMS.some((entry) => entry.to === "/task"), false);
  assert.equal(NAV_ITEMS.some((entry) => entry.to === "/conversations"), false);
  assert.equal(NAV_ITEMS.some((entry) => entry.to === "/sentinel"), false);
  assert.deepEqual(NAV_GROUPS.find((group) => group.label === "Core")?.entries.map(({ to }) => to), ["/", "/diary", "/day-space", "/universe"]);
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

test("unknown paths redirect to Home with replacement semantics", async () => {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://leilei.test/definitely-not-a-real-route" },
  );
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key as keyof Window],
    });
  }

  const root = createRoot(dom.window.document.getElementById("root")!);
  root.render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/definitely-not-a-real-route"] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: "/",
          element: React.createElement(
            "main",
            null,
            "Home",
            React.createElement(RouteStateProbe),
          ),
        }),
        React.createElement(Route, {
          path: "*",
          element: React.createElement(Navigate, { to: "/", replace: true }),
        }),
      ),
    ),
  );

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (dom.window.document.body.textContent?.includes("Home")) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(dom.window.document.body.textContent ?? "", /Home/);
  assert.match(dom.window.document.body.textContent ?? "", /\/\|REPLACE/);
  assert.match(appSource, /<Route\s+path="\*"\s+element=\{<Navigate\s+to="\/"\s+replace\s*\/?>\}/);

  root.unmount();
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (const key of ["window", "document", "navigator"]) {
    const descriptor = previous.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  dom.window.close();
});

test("route scroll manager treats every System page as a top-level destination", () => {
  for (const [, route] of EXPECTED_SYSTEM_ENTRIES) {
    assert.match(routeScrollSource, new RegExp(`"${route.replace("/", "\\/")}"`));
  }
  assert.match(routeScrollSource, /"\/settings"/);
});
