import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { BrowserRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import { DashboardPageContent } from "../web/src/pages/DashboardPage.js";

const dashboardSource = readFileSync(new URL("../web/src/pages/DashboardPage.tsx", import.meta.url), "utf8");
test("Home keeps only the approved Todo panels and Calendar structure", () => {
  assert.match(dashboardSource, /TodayPanel/);
  assert.doesNotMatch(dashboardSource, /StickyPreview|HOME_STICKIES/);
  assert.match(dashboardSource, /CalendarPreview/);
  assert.match(dashboardSource, />Todo</);
  assert.doesNotMatch(dashboardSource, />Records</);
  assert.doesNotMatch(dashboardSource, /records-section|home-bottom-nav/);
  assert.doesNotMatch(dashboardSource, /hero-panel|orbit|space-card|quickTarget|Archive|Today at a glance|Wednesday, August 5|新增（预览）/);
  assert.match(dashboardSource, /loadTodoDay/);
});


function installDashboardDom() {
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

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 100));

async function waitForCondition(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test("Dashboard renders server-backed Home papers", async () => {
  const env = installDashboardDom();
  const container = env.dom.window.document.getElementById("root")!;
  let requestCount = 0;
  const api = { request: async (path: string) => { requestCount += 1; return { success: true, data: { date: path.split("/").at(-1), papers: { L: { author: "L", date: "2026-08-12", revision: 1, entries: [{ id: "l-1", kind: "pending", text: "整理今天的事情" }] }, G: { author: "G", date: "2026-08-12", revision: 1, entries: [{ id: "g-1", kind: "record", text: "记录" }] }, C: { author: "C", date: "2026-08-12", revision: 1, entries: [{ id: "c-1", kind: "pending", text: "Claude item" }] } } } }; } };
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
    api,
  })));
  await waitForCondition(() => requestCount >= 1, "Dashboard server-backed paper request");
  await waitForCondition(
    () => container.querySelectorAll(".today-panel").length === 3 &&
      container.querySelector(".calendar-preview") !== null,
    "Dashboard Home render",
  );
  assert.equal(container.querySelector("h1")?.textContent, "Todo");
  assert.equal(container.querySelector<HTMLButtonElement>('[aria-label="新增 Todo"]')?.disabled, false);
  assert.doesNotMatch(container.textContent ?? "", /Today|Wednesday|August 5|最新更新|新增/);
  assert.equal(container.querySelectorAll(".today-panel").length, 3);
  assert.equal(container.querySelectorAll(".sticky-card").length, 0);
  assert.ok(container.querySelector(".calendar-preview"));
  assert.equal(container.querySelectorAll(".home-bottom-nav a").length, 0);
  assert.equal(container.querySelector(".records-section"), null);
  assert.equal(container.querySelectorAll(".calendar-frame").length, 1);
  assert.equal(container.querySelector(".hero-panel"), null);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("C Todo panel opens a modal with its own fixture notes", async () => {
  const env = installDashboardDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
    api: { request: async (path: string) => ({ success: true, data: { date: path.split("/").at(-1), papers: { L: { author: "L", date: "2026-08-12", revision: 1, entries: [{ id: "l-1", kind: "pending", text: "First" }] }, G: { author: "G", date: "2026-08-12", revision: 1, entries: [{ id: "g-1", kind: "record", text: "Second" }] }, C: { author: "C", date: "2026-08-12", revision: 1, entries: [{ id: "c-1", kind: "pending", text: "Claude item" }] } } } }) },
  })));
  await waitForCondition(
    () => container.querySelectorAll<HTMLButtonElement>(".today-panel").length === 3,
    "Dashboard paper panels",
  );
  const panels = [...container.querySelectorAll<HTMLButtonElement>(".today-panel")];
  panels[2]?.focus();
  panels[2]?.click();
  await waitForCondition(
    () => container.querySelectorAll('[role="dialog"]').length === 1 &&
      env.dom.window.document.body.style.overflow === "hidden",
    "paper detail modal open",
  );
  assert.match(container.querySelector('[role="dialog"]')?.textContent ?? "", /C/);
  const close = container.querySelector<HTMLButtonElement>(".paper-detail-veil");
  close?.click();
  await waitForCondition(
    () => container.querySelector('[role="dialog"]') === null &&
    env.dom.window.document.activeElement === panels[2],
    "paper detail modal close",
  );
  root.unmount();
  await waitForPaint();
  env.restore();
});


test("Todo create entry reuses author-specific paper editor", async () => {
  const env = installDashboardDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
    api: { request: async (path: string) => ({ success: true, data: { date: path.split("/").at(-1), papers: { L: null, G: null, C: null } } }) },
  })));
  await waitForCondition(() => !!container.querySelector<HTMLButtonElement>('[aria-label="新增 Todo"]:not(:disabled)'), "create action enabled");
  const create = container.querySelector<HTMLButtonElement>('[aria-label="新增 Todo"]')!;
  create.click();
  await waitForCondition(() => create.getAttribute("aria-expanded") === "true", "Todo author options expanded");
  const choices = container.querySelectorAll<HTMLButtonElement>(".home-create-options button");
  assert.deepEqual([...choices].map((button) => button.textContent), ["L", "G", "C"]);
  choices[1]!.click();
  await waitForCondition(() => container.querySelector('[role="dialog"]') !== null, "create G Todo dialog");
  assert.match(container.querySelector('[role="dialog"]')?.getAttribute("aria-label") ?? container.querySelector('[role="dialog"]')?.textContent ?? "", /G/);
  container.querySelector<HTMLButtonElement>(".paper-detail-veil")?.click();
  await waitForCondition(() => container.querySelector('[role="dialog"]') === null, "create Todo dialog closed");
  root.unmount();
  await waitForPaint();
  env.restore();
});
