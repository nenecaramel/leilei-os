import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { BrowserRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import test from "node:test";
import {
  G_HOME_NOTES,
  HOME_CALENDAR_DAYS,
  L_HOME_NOTES,
  type HomeNote,
} from "../web/src/pages/home-prototype-data.js";
import { DashboardPageContent } from "../web/src/pages/DashboardPage.js";
import { DEFAULT_SETTINGS } from "../web/src/settings/types.js";

const dashboardSource = readFileSync(new URL("../web/src/pages/DashboardPage.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

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

test("Home fixture collections use one typed L/G note structure", () => {
  const noteShape = (note: HomeNote) => {
    assert.ok(note.id);
    assert.ok(note.text.trim());
    assert.ok(["L", "G"].includes(note.author));
    assert.ok(["pending", "completed", "record"].includes(note.kind));
  };
  assert.ok(L_HOME_NOTES.length >= 3);
  assert.ok(G_HOME_NOTES.length >= 3);
  L_HOME_NOTES.forEach(noteShape);
  G_HOME_NOTES.forEach(noteShape);
  assert.ok(HOME_CALENDAR_DAYS.length >= 28);
});

test("Home is fixture-only and does not retain the dashboard API modules", () => {
  assert.match(dashboardSource, />Todo</);
  assert.match(dashboardSource, />Records</);
  assert.match(dashboardSource, /records-section/);
  assert.match(dashboardSource, /home-preview-section/);
  assert.match(dashboardSource, /TodayPanel/);
  assert.match(dashboardSource, /CalendarPreview/);
  assert.doesNotMatch(dashboardSource, /StickyPreview|HOME_STICKIES/);
  assert.doesNotMatch(dashboardSource, /hero-panel|orbit|space-card|quickTarget/);
  assert.doesNotMatch(dashboardSource, /api\.request\(["']\/(?:memory|diary|task)/);
});

test("Home renders compact L/G Todo panels, Calendar, and no authenticated module requests", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const requests: string[] = [];
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
    api: { request: async (path: string) => { requests.push(path); return { data: {} }; } },
    settings: DEFAULT_SETTINGS,
  })));
  await waitForPaint();
  assert.equal(container.querySelector("h1")?.textContent, "Todo");
  assert.doesNotMatch(container.textContent ?? "", /Today|Wednesday|August 5|最新更新|新增/);
  assert.equal(container.querySelectorAll(".today-panel").length, 2);
  assert.equal(container.querySelectorAll(".sticky-card").length, 0);
  assert.doesNotMatch(container.textContent ?? "", /Sticky/);
  assert.ok(container.querySelector(".calendar-grid"));
  assert.equal(container.querySelectorAll(".calendar-day").length, 42);
  assert.equal(container.querySelectorAll(".calendar-day i").length, 0);
  assert.equal(container.querySelectorAll(".home-bottom-nav a").length, 4);
  assert.equal(
    container.querySelector(".records-section .home-section-heading h2")?.textContent,
    "Records",
  );
  assert.equal(container.querySelector(".hero-panel"), null);
  assert.equal(container.querySelector(".space-card"), null);
  assert.deepEqual(requests, []);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Home L/G dialogs are scrollable, closable, and restore trigger focus", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, { settings: DEFAULT_SETTINGS })));
  await waitForPaint();
  const lPanel = container.querySelector<HTMLButtonElement>(".today-panel-l")!;
  lPanel.focus();
  lPanel.click();
  await waitForPaint();
  assert.equal(container.querySelector('[role="dialog"]')?.getAttribute("aria-modal"), "true");
  assert.equal(document.body.style.overflow, "hidden");
  const close = container.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="关闭今日记录"]')!;
  close.click();
  await waitForPaint();
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(document.body.style.overflow, "");
  assert.equal(env.dom.window.document.activeElement, lPanel);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Home mobile top bar moves controls upward and inward without moving Home content", () => {
  assert.match(
    stylesSource,
    /body:has\(\.home-prototype\) \.mobile-top-bar\s*\{[\s\S]*?min-height:\s*calc\(44px \+ env\(safe-area-inset-top,\s*0px\)\)[\s\S]*?height:\s*calc\(44px \+ env\(safe-area-inset-top,\s*0px\)\)/,
  );
  assert.match(
    stylesSource,
    /body:has\(\.home-prototype\) \.mobile-top-bar-title[\s\S]*?top:\s*calc\(env\(safe-area-inset-top,\s*0px\) \+ 8px\)/,
  );
  assert.match(
    stylesSource,
    /body:has\(\.home-prototype\) \.mobile-menu-button,[\s\S]*?body:has\(\.home-prototype\) \.mobile-search-link[\s\S]*?top:\s*calc\(env\(safe-area-inset-top,\s*0px\) \+ 0px\)/,
  );
  assert.match(
    stylesSource,
    /body:has\(\.home-prototype\) \.mobile-menu-button\s*\{[\s\S]*?left:\s*18px/,
  );
  assert.match(
    stylesSource,
    /body:has\(\.home-prototype\) \.mobile-search-link\s*\{[\s\S]*?right:\s*18px/,
  );
  assert.match(
    stylesSource,
    /\.home-prototype\s*\{[\s\S]*?padding:\s*18px 0/,
  );
});

test("Home and mobile shell CSS keep the prototype compact and safe", () => {
  const homeV2Styles = stylesSource.slice(stylesSource.lastIndexOf("/* Mobile Home v2:"));
  assert.match(stylesSource, /\.mobile-top-bar\s*\{/);
  assert.match(stylesSource, /\.mobile-drawer-panel[\s\S]*?width:\s*min\(82vw,\s*280px\)/);
  assert.match(stylesSource, /\.mobile-drawer-panel[\s\S]*?background:\s*#FFFFFE/);
  assert.match(
    stylesSource,
    /\.mobile-drawer-panel[\s\S]*?--mobile-drawer-item-padding:\s*16px/,
  );
  assert.match(
    stylesSource,
    /\.mobile-drawer-header[\s\S]*?margin-bottom:\s*30px/,
  );
  assert.match(
    stylesSource,
    /\.mobile-drawer-panel[\s\S]*?padding:\s*calc\(env\(safe-area-inset-top,\s*0px\) \+ 8px\)/,
  );
  assert.match(
    stylesSource,
    /\.mobile-drawer-header strong[\s\S]*?font-size:\s*20px[\s\S]*?line-height:\s*28px/,
  );
  assert.match(
    stylesSource,
    /\.mobile-drawer \.navigation-groups[\s\S]*?gap:\s*26px/,
  );
  assert.match(
    stylesSource,
    /\.mobile-drawer \.navigation-group\s*\{[\s\S]*?gap:\s*2px/,
  );
  assert.match(
    stylesSource,
    /\.mobile-drawer \.navigation-group h2[\s\S]*?margin:\s*0 var\(--mobile-drawer-item-padding\) 0/,
  );
  assert.match(
    stylesSource,
    /\.mobile-drawer \.nav-item\s*\{[\s\S]*?min-height:\s*40px[\s\S]*?height:\s*40px[\s\S]*?font-size:\s*15px[\s\S]*?line-height:\s*20px/,
  );
  assert.match(stylesSource, /\.mobile-drawer \.nav-item svg,[\s\S]*?display:\s*none/);
  assert.match(stylesSource, /env\(safe-area-inset-top/);
  assert.match(stylesSource, /\.today-panel-dialog[\s\S]*?max-height:\s*min\(88dvh/);
  assert.match(stylesSource, /\.calendar-grid[\s\S]*?grid-template-columns:\s*repeat\(7,/);
  assert.match(stylesSource, /\.calendar-preview-header[\s\S]*?grid-template-columns:\s*28px 1fr 28px/);
  assert.match(
    stylesSource,
    /\.home-preview-section\s*\{[^}]*display:\s*grid[^}]*padding:\s*0/,
  );
  assert.match(
    stylesSource,
    /\.calendar-preview\s*\{[^}]*gap:\s*11px[^}]*margin-top:\s*6px/,
  );
  assert.match(
    stylesSource,
    /\.records-section\s*\{[^}]*gap:\s*5px[^}]*margin-top:\s*12px/,
  );
  assert.match(stylesSource, /\.home-page-title\s*\{[^}]*font-weight:\s*500/);
  assert.match(
    stylesSource,
    /body:has\(\.home-prototype\) \.mobile-top-bar-title\s*\{[^}]*font-weight:\s*500/,
  );
  assert.match(
    stylesSource,
    /\.mobile-drawer-header strong\s*\{[^}]*font-weight:\s*500/,
  );
  assert.match(
    stylesSource,
    /\.home-section-heading h2\s*\{[^}]*font-weight:\s*500/,
  );
  assert.match(
    stylesSource,
    /@media \(min-width:\s*761px\)[\s\S]*?\.records-section[\s\S]*?grid-column:\s*1 \/ -1/,
  );
  assert.match(
    stylesSource,
    /\.home-bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*column-gap:\s*8px[^}]*row-gap:\s*10px/,
  );
  assert.match(
    stylesSource,
    /\.home-bottom-nav a\s*\{[^}]*height:\s*35px[^}]*min-height:\s*35px/,
  );
  assert.match(
    stylesSource,
    /\.home-bottom-nav a\s*\{[^}]*place-items:\s*center/,
  );
  assert.match(stylesSource, /body:has\(\.home-prototype\) \.mobile-top-bar-title[\s\S]*?left:\s*50%[\s\S]*?transform:\s*translateX\(-50%\)/);
  assert.match(stylesSource, /min-width:\s*44px/);
  assert.match(stylesSource, /:focus-visible/);
  assert.match(stylesSource, /body:has\(\.home-prototype\) \.mobile-top-bar/);
  assert.match(stylesSource, /html:has\(\.home-prototype\)[\s\S]*?#root:has\(\.home-prototype\)/);
  assert.doesNotMatch(stylesSource, /\.home-prototype[\s\S]*?hero-panel|\.home-prototype[\s\S]*?orbit/);
  assert.doesNotMatch(homeV2Styles, /radial-gradient|linear-gradient|color-mix/);
});
