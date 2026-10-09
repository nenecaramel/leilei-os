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
  ["Account", "/settings/account"],
  ["Status", "/settings/status"],
  ["Data", "/settings/data"],
  ["About", "/settings/about"],
] as const;

test("System navigation exposes exactly the four approved modules", () => {
  const system = NAV_GROUPS.find((group) => group.label === "Settings");
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
  assert.deepEqual(NAV_GROUPS.find((group) => group.label === "Core")?.entries.map(({ to }) => to), ["/", "/mind", "/diary", "/day-space", "/universe"]);
  assert.doesNotMatch(
    navigationSource,
    /includeSecondarySystemItems|General|Appearance|Data & Backup/,
  );
  assert.doesNotMatch(drawerSource, /includeSecondarySystemItems/);
});

test("System routes register all four pages and preserve legacy redirects", () => {
  for (const [, route] of EXPECTED_SYSTEM_ENTRIES) {
    const relative = route.slice(1).replace("/", "\\/");
    assert.match(appSource, new RegExp(`path="${relative}"`));
  }

  assert.match(
    appSource,
    /path="system"[\s\S]*?<Navigate[\s\S]*?to="\/settings\/account"[\s\S]*?replace/,
  );
  assert.match(
    appSource,
    /path="settings"[\s\S]*?<Navigate[\s\S]*?to="\/settings\/account"[\s\S]*?replace/,
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

test("actual App renders all Settings pages and replaces every legacy bookmark", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://leilei.test/settings" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React,
    __LEILEI_VERSION__: "0.1.0", __LEILEI_COMMIT__: "fixture", __LEILEI_MODE__: "development" })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  dom.window.scrollTo = () => {};
  try {
    const { default: App } = await import("../web/src/App.js");
    const { Auth0Context } = await import("../web/node_modules/@auth0/auth0-react/dist/auth0-react.cjs.js");
    const auth = { isAuthenticated: true, isLoading: false, user: { name: "Lei", email: "lei@example.test" }, getAccessTokenSilently: async () => "fixture" };
    for (const [from, destination, title] of [
      ["/settings", "/settings/account", "Account"],
      ["/system", "/settings/account", "Account"],
      ["/system/account", "/settings/account", "Account"],
      ["/system/connections", "/settings/status", "Status"],
      ["/system/data", "/settings/data", "Data"],
      ["/system/about", "/settings/about", "About"],
      ["/system/activity", "/settings/account", "Account"],
      ...EXPECTED_SYSTEM_ENTRIES.map(([title, path]) => [path, path, title]),
    ]) {
      dom.window.history.replaceState(null, "", from);
      const root = createRoot(dom.window.document.getElementById("root")!);
      try {
        root.render(React.createElement(Auth0Context.Provider, { value: auth as never }, React.createElement(App)));
        for (let attempt = 0; attempt < 100; attempt++) {
          if (dom.window.location.pathname === destination && dom.window.document.querySelector("h1")?.textContent === title) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.equal(dom.window.location.pathname, destination, from);
        assert.equal(dom.window.document.querySelector("h1")?.textContent, title, from);
        assert.equal(dom.window.document.querySelector('a[href="/system/activity"]'), null);
        if (from.startsWith("/system") || from === "/settings") {
          assert.equal(dom.window.history.state?.idx, 0, "legacy redirect must replace the current entry");
        }
      } finally {
        root.unmount();
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }
});
