import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AUTOMATIC_HERO_TITLE,
  getDashboardHeroDescription,
  getDashboardHeroTitle,
  getDashboardBadge,
} from "../web/src/pages/DashboardPage.js";
import { summarizeDashboardTasks } from "../web/src/pages/dashboard-tasks.js";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { BrowserRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import { DEFAULT_SETTINGS } from "../web/src/settings/types.js";
import { DashboardPageContent } from "../web/src/pages/DashboardPage.js";

const dashboardSource = readFileSync(new URL("../web/src/pages/DashboardPage.tsx", import.meta.url), "utf8");
const taskSource = readFileSync(new URL("../web/src/pages/TaskPage.tsx", import.meta.url), "utf8");

test("Dashboard exposes exactly the three core modules and the required task metrics", () => {
  assert.equal((dashboardSource.match(/quickTarget="(?:memory|diary|task)"/g) ?? []).length, 3);
  assert.doesNotMatch(dashboardSource, /Archive/);
  assert.doesNotMatch(dashboardSource, /Today at a glance/);
  assert.match(dashboardSource, /新增记忆/);
  assert.match(dashboardSource, /写日记/);
  assert.match(dashboardSource, /新建任务/);
  assert.match(dashboardSource, /3 modules connected/);
  assert.match(dashboardSource, /正在读取/);
  assert.match(dashboardSource, /读取失败/);
  assert.match(dashboardSource, /\[0, 1, 2\]/);
  const summary = summarizeDashboardTasks([
    { status: "pending", due_time: "2026-01-01", time_bucket: "overdue" },
    { status: "in_progress", due_time: null, time_bucket: "no_due_date" },
    { status: "completed", due_time: null, time_bucket: "overdue" },
    { status: "cancelled", due_time: null, time_bucket: "overdue" },
  ]);
  assert.equal(`${summary.openTasks.length} 项待处理 · ${summary.overdueTaskCount} 项逾期 · ${summary.completedTasks.length} 项已完成`, "2 项待处理 · 1 项逾期 · 1 项已完成");
});

test("Dashboard module cards keep list links separate from quick-create buttons", () => {
  assert.match(dashboardSource, /<Link className="space-card-main"[\s\S]*?to=\{href\}/);
  assert.match(dashboardSource, /<button className="secondary-button" type="button"[\s\S]*?quickTarget/);
  assert.match(dashboardSource, /<Link className="space-card-main"[\s\S]*?<\/Link>[\s\S]*?<button className="secondary-button"/);
});

test("automatic Dashboard Hero is truthful in loading, ready, and error states", () => {
  assert.equal(getDashboardHeroTitle("ready"), AUTOMATIC_HERO_TITLE);
  assert.equal(getDashboardHeroTitle("loading"), "正在读取你的个人系统。");
  assert.equal(getDashboardHeroTitle("error"), "Dashboard 暂时无法读取。");
  assert.equal(getDashboardBadge("ready"), "3 modules connected");
  assert.equal(getDashboardBadge("loading"), "正在读取");
  assert.equal(getDashboardBadge("error"), "读取失败");
  assert.match(getDashboardHeroDescription("ready", { memory: 7, diary: 3, openTasks: 2, overdue: 1 }), /Memory 有 7 条记忆/);
  assert.equal(getDashboardHeroDescription("loading"), "正在读取 Memory、Diary 和 Task。");
  assert.equal(getDashboardHeroDescription("error"), "暂时无法读取 Dashboard，请重试。");
});

test("custom Dashboard Hero text remains stable while blank custom values use status fallbacks", () => {
  assert.equal(getDashboardHeroTitle("loading", "自定义标题"), "自定义标题");
  assert.equal(getDashboardHeroDescription("error", undefined, "自定义描述"), "自定义描述");
  assert.equal(getDashboardHeroTitle("ready", "   "), AUTOMATIC_HERO_TITLE);
  assert.equal(getDashboardHeroDescription("loading", undefined, "\t"), "正在读取 Memory、Diary 和 Task。");
});

test("Dashboard keeps a private three-column grid without changing generic space-grid", () => {
  assert.match(dashboardSource, /dashboard-module-grid/);
  assert.match(readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8"), /\.space-grid\s*\{[\s\S]*?grid-template-columns: repeat\(4,/);
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
  for (const key of ["window", "document", "navigator"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] });
  }
  (globalThis as { React?: unknown }).React = React;
  return { dom, restore() {
    for (const key of ["window", "document", "navigator"]) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }};
}

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 20));
function dashboardElement(props: { api: unknown; settings: typeof DEFAULT_SETTINGS }) {
  return React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, props as never));
}

const dashboardPayloads = {
  "/memory": { success: true, data: { metadata: { count: 7 } } },
  "/diary": { success: true, data: { metadata: { count: 3 } } },
  "/task": { success: true, data: { metadata: { count: 4 }, tasks: [
    { id: "1", title: "open", description: "", status: "pending", due_time: "2026-01-01", timezone: "Asia/Shanghai", time_bucket: "overdue" },
    { id: "2", title: "done", description: "", status: "completed", due_time: null, timezone: "Asia/Shanghai", time_bucket: "overdue" },
    { id: "3", title: "cancelled", description: "", status: "cancelled", due_time: null, timezone: "Asia/Shanghai", time_bucket: "overdue" },
  ] } },
} as const;

test("Dashboard component renders truthful loading and ready states with three ordered cards", async () => {
  const env = installDashboardDom();
  const container = env.dom.window.document.getElementById("root")!;
  const pendingApi = { request: async () => new Promise<never>(() => {}) };
  const root = createRoot(container);
  root.render(dashboardElement({ api: pendingApi, settings: DEFAULT_SETTINGS }));
  await waitForPaint();
  assert.equal(container.querySelector(".hero-panel h2")?.textContent, "正在读取你的个人系统。");
  assert.equal(container.querySelector(".live-badge")?.textContent, "正在读取");
  assert.equal(container.querySelectorAll(".memory-card-loading").length, 3);

  root.unmount();
  const api = { request: async <T,>(path: string): Promise<T> => dashboardPayloads[path as keyof typeof dashboardPayloads] as T };
  const readyRoot = createRoot(container);
  readyRoot.render(dashboardElement({ api, settings: DEFAULT_SETTINGS }));
  await waitForPaint();
  await waitForPaint();
  assert.equal(container.querySelector(".hero-panel h2")?.textContent, "你的个人系统正在持续运转。");
  assert.equal(container.querySelector(".live-badge")?.textContent, "3 modules connected");
  assert.deepEqual([...container.querySelectorAll(".space-card h3")].map((node) => node.textContent), ["Memory", "Diary", "Task"]);
  assert.equal(container.querySelectorAll(".space-card").length, 3);
  for (const card of container.querySelectorAll(".space-card")) {
    assert.ok(card.querySelector("a.space-card-main"));
    assert.ok(card.querySelector("button.secondary-button"));
  }
  readyRoot.unmount();
  await waitForPaint();
  env.restore();
});

test("Dashboard component renders error state and custom Hero text without success claims", async () => {
  const env = installDashboardDom();
  const container = env.dom.window.document.getElementById("root")!;
  const api = { request: async () => { throw new Error("unavailable"); } };
  const root = createRoot(container);
  root.render(dashboardElement({ api, settings: { ...DEFAULT_SETTINGS, page_copy: { ...DEFAULT_SETTINGS.page_copy, home_hero_title_mode: "custom", home_hero_title: "我的首页", home_hero_description_mode: "custom", home_hero_description: "我的描述" } } }));
  await waitForPaint();
  await waitForPaint();
  assert.equal(container.querySelector(".hero-panel h2")?.textContent, "我的首页");
  assert.equal(container.querySelector(".hero-panel p")?.textContent, "我的描述");
  assert.equal(container.querySelector(".live-badge")?.textContent, "读取失败");
  assert.ok(container.querySelector('section[role="alert"]'));
  assert.equal(container.querySelector(".hero-panel")?.textContent.includes("3 modules connected"), false);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Dashboard component falls back from blank custom Hero values by status", async () => {
  const env = installDashboardDom();
  const container = env.dom.window.document.getElementById("root")!;
  const api = { request: async () => new Promise<never>(() => {}) };
  const root = createRoot(container);
  root.render(dashboardElement({
    api,
    settings: {
      ...DEFAULT_SETTINGS,
      page_copy: {
        ...DEFAULT_SETTINGS.page_copy,
        home_hero_title_mode: "custom",
        home_hero_title: "   ",
        home_hero_description_mode: "custom",
        home_hero_description: "\t",
      },
    },
  }));
  await waitForPaint();
  assert.equal(container.querySelector(".hero-panel h2")?.textContent, "正在读取你的个人系统。");
  assert.equal(container.querySelector(".hero-panel p")?.textContent, "正在读取 Memory、Diary 和 Task。");
  root.unmount();
  await waitForPaint();
  env.restore();
});
