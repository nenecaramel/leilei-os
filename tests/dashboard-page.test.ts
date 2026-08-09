import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { BrowserRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import { DashboardPageContent } from "../web/src/pages/DashboardPage.js";

const dashboardSource = readFileSync(new URL("../web/src/pages/DashboardPage.tsx", import.meta.url), "utf8");
const taskSource = readFileSync(new URL("../web/src/pages/TaskPage.tsx", import.meta.url), "utf8");

test("Home prototype keeps the approved Todo, L/G, Calendar and footer structure", () => {
  assert.match(dashboardSource, /TodayPanel/);
  assert.doesNotMatch(dashboardSource, /StickyPreview|HOME_STICKIES/);
  assert.match(dashboardSource, /CalendarPreview/);
  assert.match(dashboardSource, />Todo</);
  assert.match(dashboardSource, />Records</);
  assert.match(dashboardSource, /records-section/);
  assert.match(dashboardSource, /home-bottom-nav/);
  assert.doesNotMatch(dashboardSource, /hero-panel|orbit|space-card|quickTarget|Archive|Today at a glance|Wednesday, August 5|新增（预览）/);
  assert.doesNotMatch(dashboardSource, /api\.request|fetch\(/);
});

test("Task keeps its create form before filters and wires title focus", () => {
  const createIndex = taskSource.indexOf("<h2>创建任务</h2>");
  const filtersIndex = taskSource.indexOf('className="memory-message task-filters"');
  assert.ok(createIndex >= 0 && filtersIndex >= 0 && createIndex < filtersIndex);
  assert.match(taskSource, /ref=\{createTitleInput\}/);
  assert.match(taskSource, /focusCreateRef\.current = true/);
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

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 20));

test("Dashboard renders the fixture-backed Home view without API requests", async () => {
  const env = installDashboardDom();
  const container = env.dom.window.document.getElementById("root")!;
  let requestCount = 0;
  const api = { request: async () => { requestCount += 1; throw new Error("Home must not request module APIs"); } };
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
    api,
  })));
  await waitForPaint();
  assert.equal(container.querySelector("h1")?.textContent, "Todo");
  assert.doesNotMatch(container.textContent ?? "", /Today|Wednesday|August 5|最新更新|新增/);
  assert.equal(container.querySelectorAll(".today-panel").length, 2);
  assert.equal(container.querySelectorAll(".sticky-card").length, 0);
  assert.ok(container.querySelector(".calendar-preview"));
  assert.equal(container.querySelectorAll(".home-bottom-nav a").length, 4);
  assert.equal(
    container.querySelector(".records-section .home-section-heading h2")?.textContent,
    "Records",
  );
  assert.equal(container.querySelectorAll(".calendar-frame").length, 1);
  assert.deepEqual([...container.querySelectorAll(".home-bottom-nav a")].map((link) => link.textContent), ["Memory", "Diary", "Task", "Universe"]);
  assert.equal(container.querySelector(".hero-panel"), null);
  assert.equal(requestCount, 0);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("L and G panels open a modal with their own fixture notes", async () => {
  const env = installDashboardDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
    api: { request: async () => { throw new Error("unexpected request"); } },
  })));
  await waitForPaint();
  const panels = [...container.querySelectorAll<HTMLButtonElement>(".today-panel")];
  panels[0]?.focus();
  panels[0]?.click();
  await waitForPaint();
  assert.equal(container.querySelectorAll('[role="dialog"]').length, 1);
  assert.match(container.querySelector('[role="dialog"]')?.textContent ?? "", /L/);
  assert.equal(env.dom.window.document.body.style.overflow, "hidden");
  const close = container.querySelector<HTMLButtonElement>(".paper-detail-veil");
  close?.click();
  await waitForPaint();
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(env.dom.window.document.activeElement, panels[0]);
  root.unmount();
  await waitForPaint();
  env.restore();
});
