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

test("navigation groups expose the Home, Utilities, System and disabled Day Space contracts", () => {
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
    assert.ok(container.querySelector('a[href="/settings"]')?.textContent?.includes("System"));
    assert.ok(container.querySelector('[aria-disabled="true"]')?.textContent?.includes("Day Space"));
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
  await waitForPaint();
  assert.equal(env.dom.window.document.body.style.overflow, "hidden");
  const dialog = container.querySelector('[role="dialog"]');
  assert.equal(dialog?.getAttribute("aria-modal"), "true");
  assert.equal(dialog?.getAttribute("tabindex"), "-1");
  assert.equal(env.dom.window.document.activeElement, dialog);
  assert.equal(container.querySelector(".mobile-drawer-header .icon-button"), null);
  assert.match(container.textContent ?? "", /General/);
  assert.match(container.textContent ?? "", /Appearance/);
  assert.match(container.textContent ?? "", /Data & Backup/);
  assert.match(container.textContent ?? "", /About/);
  env.dom.window.document.dispatchEvent(new env.dom.window.KeyboardEvent("keydown", { key: "Escape" }));
  await waitForPaint();
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(env.dom.window.document.body.style.overflow, "");
  assert.equal(env.dom.window.document.activeElement, trigger);

  open = true;
  render();
  await waitForPaint();
  (container.querySelector(".mobile-drawer-backdrop") as HTMLButtonElement)?.click();
  await waitForPaint();
  assert.equal(container.querySelector('[role="dialog"]'), null);

  open = true;
  render();
  await waitForPaint();
  (container.querySelector('a[href="/memory"]') as HTMLAnchorElement)?.dispatchEvent(new env.dom.window.MouseEvent("click", { bubbles: true }));
  await waitForPaint();
  assert.equal(container.querySelector('[role="dialog"]'), null);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("mobile top bar exposes the menu state and Global Search link", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const menuButtonRef = { current: null as HTMLButtonElement | null };
  const root = createRoot(container);
  root.render(React.createElement(MemoryRouter, null, React.createElement(MobileTopBar, {
    menuOpen: false,
    menuButtonRef,
    onMenuClick: () => undefined,
  })));
  await waitForPaint();
  const menuButton = container.querySelector<HTMLButtonElement>(".mobile-menu-button");
  assert.equal(menuButton?.getAttribute("aria-expanded"), "false");
  assert.equal(menuButton?.getAttribute("aria-controls"), "mobile-navigation-drawer");
  assert.equal(container.querySelector('a[href="/search"]')?.getAttribute("aria-label"), "打开 Global Search");
  root.unmount();
  await waitForPaint();
  env.restore();
});
