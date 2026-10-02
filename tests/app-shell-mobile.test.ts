import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { MemoryRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import test from "node:test";
import { NavigationGroups } from "../web/src/layout/NavigationGroups.js";
import { MobileNavigationDrawer } from "../web/src/layout/MobileNavigationDrawer.js";
import { MobileTopBar } from "../web/src/layout/MobileTopBar.js";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://leilei.test/" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "React"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "React" ? React : dom.window[key as keyof Window] });
  }
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
  return { dom, restore() {
    for (const key of ["window", "document", "navigator", "React"]) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }};
}

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 20));

async function waitForCondition(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test("navigation groups expose the Home, Utilities, System and active Day Space contracts", () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(MemoryRouter, null, React.createElement(NavigationGroups)));
  return waitForPaint().then(() => {
    assert.match(container.textContent ?? "", /Core/);
    assert.match(container.textContent ?? "", /Utilities/);
    assert.match(container.textContent ?? "", /System/);
    assert.ok(container.querySelector('a[href="/"]')?.textContent?.includes("Home"));
    assert.ok(container.querySelector('a[href="/search"]')?.textContent?.includes("Global Search"));
    assert.ok(container.querySelector('a[href="/system/account"]')?.textContent?.includes("Account"));
    assert.ok(container.querySelector('a[href="/system/connections"]')?.textContent?.includes("Connections"));
    assert.ok(container.querySelector('a[href="/system/data"]')?.textContent?.includes("Data"));
    assert.ok(container.querySelector('a[href="/system/activity"]')?.textContent?.includes("Activity"));
    assert.ok(container.querySelector('a[href="/system/about"]')?.textContent?.includes("About"));
    assert.ok(container.querySelector('a[href="/day-space"]')?.textContent?.includes("Day Space"));
    root.unmount();
    env.restore();
  });
});

test("mobile drawer closes on Escape and restores focus and body scrolling", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const trigger = env.dom.window.document.createElement("button");
  trigger.type = "button";
  env.dom.window.document.body.append(trigger);
  const root = createRoot(container);
  let open = true;
  const render = () => root.render(React.createElement(MemoryRouter, null, React.createElement(MobileNavigationDrawer, {
    open,
    onClose: () => { open = false; render(); },
    menuButtonRef: { current: trigger },
  })));
  render();
  await waitForCondition(
    () => env.dom.window.document.body.style.overflow === "hidden" &&
      container.querySelector('[role="dialog"]') !== null,
    "mobile drawer open effect",
  );
  const dialog = container.querySelector('[role="dialog"]');
  await waitForCondition(
    () => env.dom.window.document.activeElement === dialog,
    "mobile drawer focus",
  );
  assert.equal(dialog?.getAttribute("aria-modal"), "true");
  assert.equal(dialog?.getAttribute("tabindex"), "-1");
  assert.equal(container.querySelector(".mobile-drawer-header .icon-button"), null);
  assert.match(container.textContent ?? "", /Account/);
  assert.match(container.textContent ?? "", /Connections/);
  assert.match(container.textContent ?? "", /Data/);
  assert.match(container.textContent ?? "", /Activity/);
  assert.match(container.textContent ?? "", /About/);
  assert.doesNotMatch(container.textContent ?? "", /General|Appearance|Data & Backup/);
  env.dom.window.document.dispatchEvent(new env.dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  await waitForCondition(
    () => container.querySelector('[role="dialog"]') === null &&
      env.dom.window.document.body.style.overflow === "" &&
      env.dom.window.document.activeElement === trigger,
    "mobile drawer Escape cleanup",
  );

  open = true;
  render();
  await waitForCondition(
    () => container.querySelector('[role="dialog"]') !== null,
    "mobile drawer reopen",
  );
  (container.querySelector(".mobile-drawer-backdrop") as HTMLButtonElement)?.click();
  await waitForCondition(
    () => container.querySelector('[role="dialog"]') === null,
    "mobile drawer backdrop close",
  );

  open = true;
  render();
  await waitForCondition(
    () => container.querySelector('[role="dialog"]') !== null,
    "mobile drawer navigation reopen",
  );
  (container.querySelector('a[href="/diary"]') as HTMLAnchorElement)?.dispatchEvent(new env.dom.window.MouseEvent("click", { bubbles: true }));
  await waitForCondition(
    () => container.querySelector('[role="dialog"]') === null,
    "mobile drawer navigation close",
  );
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("mobile top bar exposes menu state and a Quick Search trigger while navigation keeps Global Search", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const menuButtonRef = { current: null as HTMLButtonElement | null };
  const searchButtonRef = { current: null as HTMLButtonElement | null };
  const root = createRoot(container);
  root.render(React.createElement(MemoryRouter, null, React.createElement(MobileTopBar, {
    menuOpen: false,
    menuButtonRef,
    onMenuClick: () => undefined,
    searchOpen: false,
    searchButtonRef,
    onSearchClick: () => undefined,
  })));
  await waitForPaint();
  const menuButton = container.querySelector<HTMLButtonElement>(".mobile-menu-button");
  assert.equal(menuButton?.getAttribute("aria-expanded"), "false");
  assert.equal(menuButton?.getAttribute("aria-controls"), "mobile-navigation-drawer");

  const searchButton = container.querySelector<HTMLButtonElement>(".mobile-search-link");
  assert.equal(searchButton?.tagName, "BUTTON");
  assert.equal(searchButton?.getAttribute("aria-expanded"), "false");
  assert.equal(searchButton?.getAttribute("aria-controls"), "quick-search-panel");
  assert.equal(searchButton?.getAttribute("aria-label"), "打开快速搜索");
  assert.equal(container.querySelector('a[href="/search"]'), null);

  root.unmount();
  await waitForPaint();
  env.restore();
});
