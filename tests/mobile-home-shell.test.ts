import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import test from "node:test";
import { DashboardPageContent } from "../web/src/pages/DashboardPage.js";
import { CalendarPreview } from "../web/src/pages/CalendarPreview.js";
import type { TodoEntry } from "../web/src/pages/todo-types.js";

const L_TODO_ENTRIES: TodoEntry[] = [
  { id: "l-1", kind: "pending", text: "整理今天的事情" },
  { id: "l-2", kind: "completed", text: "项目视觉方向已经确认" },
  { id: "l-3", kind: "record", text: "记录一个不强制完成的小念头" },
  { id: "l-4", kind: "record", text: "留一点空白，晚些时候再决定" },
];

const G_TODO_ENTRIES: TodoEntry[] = [
  { id: "g-1", kind: "pending", text: "项目下一步：确定侧边栏交互" },
  { id: "g-2", kind: "record", text: "明天记得向蕾蕾推进进度展开方式" },
  { id: "g-3", kind: "record", text: "准备提醒蕾蕾吃午饭啦" },
  { id: "g-4", kind: "record", text: "下一轮继续调整首页细节" },
];

const C_TODO_ENTRIES: TodoEntry[] = [
  { id: "c-1", kind: "pending", text: "整理 Claude 的下一步" },
  { id: "c-2", kind: "record", text: "记录 C 的独立纸张" },
  { id: "c-3", kind: "completed", text: "确认 C 的完成事项" },
  { id: "c-4", kind: "record", text: "为 C 留下后续笔记" },
];

const bootstrapDom = new JSDOM(
  "<!doctype html><html><body></body></html>",
  { url: "https://leilei.test/" },
);

for (const [name, value] of Object.entries({
  window: bootstrapDom.window,
  document: bootstrapDom.window.document,
  navigator: bootstrapDom.window.navigator,
})) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

const { createRoot } = await import("../web/node_modules/react-dom/client.js");
const { BrowserRouter } = await import(
  "../web/node_modules/react-router-dom/dist/index.mjs"
);

const dashboardSource = readFileSync(new URL("../web/src/pages/DashboardPage.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const todayPanelSource = readFileSync(new URL("../web/src/pages/TodayPanel.tsx", import.meta.url), "utf8");
const prototypeDataPath = new URL("../web/src/pages/home-prototype-data.ts", import.meta.url);

function installDom(actEnvironment = false) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://leilei.test/" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const keys = ["window", "document", "navigator", "React", ...(actEnvironment ? ["IS_REACT_ACT_ENVIRONMENT"] : [])];
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "React" ? React : dom.window[key as keyof Window] });
  }
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
  return { dom, restore() {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    dom.window.close();
  }};
}

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 100));

async function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("Home Todo preview uses canonical Todo entries without runtime fixtures", () => {
  const entryShape = (entry: TodoEntry) => {
    assert.ok(entry.id);
    assert.ok(entry.text.trim());
    assert.ok(["pending", "completed", "record"].includes(entry.kind));
  };
  assert.ok(L_TODO_ENTRIES.length >= 4);
  assert.ok(G_TODO_ENTRIES.length >= 4);
  assert.ok(C_TODO_ENTRIES.length >= 2);
  assert.equal(existsSync(prototypeDataPath), false);
  assert.doesNotMatch(dashboardSource, /home-prototype-data|HomeNote|HomeAuthor|previewNotes/);
  assert.doesNotMatch(todayPanelSource, /home-prototype-data|HomeNote|HomeAuthor/);
  assert.match(todayPanelSource, /TodoAuthor/);
  assert.match(todayPanelSource, /TodoEntry/);
  assert.doesNotMatch(todayPanelSource, /notes\.slice\(0,\s*3\)/);
  assert.match(todayPanelSource, /scrollHeight\s*>\s*[^;\n]*clientHeight/);
  assert.match(todayPanelSource, /today-panel-overflow/);
  L_TODO_ENTRIES.forEach(entryShape);
  G_TODO_ENTRIES.forEach(entryShape);
  C_TODO_ENTRIES.forEach(entryShape);
});

test("Home Todo preview uses three visual lines and a fading overflow marker", () => {
  assert.match(stylesSource, /\.today-panel-notes\s*\{[^}]*height:\s*60px[^}]*overflow:\s*hidden/s);
  assert.match(stylesSource, /\.today-note\s*\{[^}]*min-height:\s*20px[^}]*height:\s*auto[^}]*align-items:\s*flex-start/s);
  assert.match(stylesSource, /\.today-note > span:last-child\s*\{[^}]*white-space:\s*normal/s);
  assert.match(stylesSource, /\.today-note-completed > span:last-child\s*\{[^}]*color:\s*#8f8f8f[^}]*text-decoration:\s*line-through/s);
  assert.doesNotMatch(stylesSource, /\.today-note:nth-child\(3\)/);
  assert.match(stylesSource, /\.today-panel-overflow\s*\{[^}]*left:\s*43px[^}]*mask-image:/s);
});


test("Home uses the Todo paper coordinator and server day endpoint", () => {
  assert.match(dashboardSource, />Todo</);
  assert.doesNotMatch(dashboardSource, />Records</);
  assert.doesNotMatch(dashboardSource, /records-section|home-bottom-nav/);
  assert.match(dashboardSource, /home-prototype-content/);
  assert.match(dashboardSource, /TodayPanel/);
  assert.match(dashboardSource, /TodoPaperDialog/);
  assert.match(dashboardSource, /CalendarPreview/);
  assert.doesNotMatch(dashboardSource, /TodayPanelDialog/);
  assert.doesNotMatch(dashboardSource, /StickyPreview|HOME_STICKIES/);
  assert.doesNotMatch(dashboardSource, /hero-panel|orbit|space-card|quickTarget/);
  assert.match(dashboardSource, /loadTodoDay/);
});

test("Home renders compact L/G/C Todo panels in author order and performs real Calendar discovery", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const requests: string[] = [];
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
    now: () => new Date(2026, 7, 12, 12, 0, 0),
    api: { request: async (path: string) => {
      requests.push(path);
      if (path === "/todo/dates" || path === "/diary/dates") {
        return { success: true, data: { dates: [] } };
      }
      return { success: true, data: { date: path.split("/").at(-1), papers: { L: { author: "L", date: "2026-08-12", revision: 1, entries: L_TODO_ENTRIES.map((entry) => ({ ...entry })) }, G: { author: "G", date: "2026-08-12", revision: 1, entries: G_TODO_ENTRIES.map((entry) => ({ ...entry })) }, C: { author: "C", date: "2026-08-12", revision: 1, entries: C_TODO_ENTRIES.map((entry) => ({ ...entry })) } } } };
    } },
  })));
  await waitForCondition(
    () => {
      const panels = [...container.querySelectorAll<HTMLElement>(".today-panel")];
      return (
        container.querySelector("h1")?.textContent === "Todo" &&
        panels.length === 3 &&
        panels.every((panel) => panel.querySelectorAll(".today-note").length >= 4) &&
        container.querySelectorAll(".calendar-day").length === 42 &&
        requests.includes("/todo/dates") &&
        requests.includes("/diary/dates")
      );
    },
    "Home Todo panels and Calendar discovery",
  );
  assert.equal(container.querySelector("h1")?.textContent, "Todo");
  assert.doesNotMatch(container.textContent ?? "", /Today|Wednesday|August 5|最新更新|新增/);
  const todoPanels = [...container.querySelectorAll<HTMLElement>(".today-panel")];
  assert.equal(todoPanels.length, 3);
  assert.deepEqual(todoPanels.map((panel) => panel.querySelector(".today-panel-author")?.textContent), ["L", "G", "C"]);

  for (const panel of todoPanels) {
    const notes = [...panel.querySelectorAll<HTMLElement>(".today-note")];
    assert.ok(notes.length >= 4);

    for (const mark of panel.querySelectorAll<HTMLElement>(".today-note-mark")) {
      assert.equal(mark.textContent, "");
      assert.ok(["pending", "completed", "record"].includes(mark.dataset.kind ?? ""));
      assert.ok(mark.querySelector("span"));
    }
  }

  assert.equal(container.querySelectorAll(".sticky-card").length, 0);
  assert.doesNotMatch(container.textContent ?? "", /Sticky/);
  assert.ok(container.querySelector(".calendar-grid"));
  assert.equal(container.querySelectorAll(".calendar-day").length, 42);
  assert.equal(container.querySelectorAll(".calendar-day i").length, 0);
  assert.equal(container.querySelectorAll(".home-bottom-nav a").length, 0);
  assert.equal(container.querySelector(".records-section"), null);
  assert.equal(container.querySelector(".hero-panel"), null);
  assert.equal(container.querySelector(".space-card"), null);
  assert.deepEqual(requests, ["/todo/2026-08-12", "/todo/dates", "/diary/dates"]);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Home keeps all Todo panels visible while the day request is loading", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
    now: () => new Date(2026, 7, 12, 12, 0, 0),
    api: { request: async (path: string) => {
      if (path === "/todo/dates" || path === "/diary/dates") {
        return { success: true, data: { dates: [] } };
      }
      return new Promise(() => undefined);
    } },
  })));
  await waitForCondition(
    () => container.querySelector(".calendar-frame") !== null,
    "Home Calendar shell while Todo is loading",
  );
  assert.equal(container.querySelectorAll(".today-panel").length, 3);
  assert.doesNotMatch(container.textContent ?? "", /正在读取 Todo/);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Home opens C's dialog and saves only C's paper", async (t) => {
  const env = installDom(true);
  const container = env.dom.window.document.getElementById("root")!;
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  let acknowledge!: () => void;
  const acknowledgement = new Promise<void>(resolve => { acknowledge = resolve; });
  const root = createRoot(container);
  t.after(async () => {
    try { await React.act(async () => { acknowledge(); root.unmount(); }); }
    finally { env.restore(); }
  });
  await React.act(async () => {
    root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
      now: () => new Date(2026, 7, 12, 12, 0, 0),
      api: { request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === "/todo/dates" || path === "/diary/dates") return { success: true, data: { dates: [] } };
        if (init?.method === "PUT") {
          await acknowledgement;
          return { success: true, data: { author: "C", date: "2026-08-12", revision: 2, entries: JSON.parse(String(init.body)).entries } };
        }
        return { success: true, data: { date: "2026-08-12", papers: { L: { author: "L", date: "2026-08-12", revision: 1, entries: L_TODO_ENTRIES.map(entry => ({ ...entry })) }, G: { author: "G", date: "2026-08-12", revision: 1, entries: G_TODO_ENTRIES.map(entry => ({ ...entry })) }, C: { author: "C", date: "2026-08-12", revision: 1, entries: C_TODO_ENTRIES.map(entry => ({ ...entry })) } } } };
      } },
    })));
  });
  assert.equal(container.querySelectorAll(".today-panel").length, 3);
  assert.match(container.querySelector(".today-panel-c")?.textContent ?? "", /整理 Claude 的下一步/);
  const lPreviewBefore = container.querySelector(".today-panel-l")?.textContent;
  const gPreviewBefore = container.querySelector(".today-panel-g")?.textContent;
  const cPanel = container.querySelector<HTMLButtonElement>(".today-panel-c")!;
  await React.act(async () => { cPanel.click(); });
  assert.ok(container.querySelector("#today-panel-dialog-c"));
  const status = container.querySelector<HTMLButtonElement>(".todo-paper-status")!;
  await React.act(async () => { status.click(); });
  assert.equal(status.dataset.kind, "completed");
  const veil = container.querySelector<HTMLButtonElement>(".paper-detail-veil")!;
  await React.act(async () => { veil.click(); veil.click(); });
  const writes = requests.filter(request => request.init?.method === "PUT");
  assert.equal(writes.length, 1, "repeat close must not duplicate the pending save");
  assert.equal(writes[0].path, "/todo/2026-08-12/C");
  assert.equal(JSON.parse(String(writes[0].init?.body)).entries[0].kind, "completed");
  assert.ok(container.querySelector('[role="dialog"]'), "close waits for the save acknowledgement");
  await React.act(async () => { acknowledge(); await acknowledgement; });
  assert.equal(container.querySelector('[role="dialog"]'), null);
  await waitForCondition(() => env.dom.window.document.activeElement === cPanel, "C trigger focus restoration");
  assert.equal(container.querySelector(".today-panel-l")?.textContent, lPreviewBefore);
  assert.equal(container.querySelector(".today-panel-g")?.textContent, gPreviewBefore);
  assert.ok(container.querySelector(".today-panel-c .today-note")?.classList.contains("today-note-completed"));
});

test("Calendar loading keeps its shell without visible loading copy", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(CalendarPreview, {
    contentDates: [],
    date: new Date(2026, 7, 12, 12, 0, 0),
    status: "loading",
  })));
  await waitForCondition(
    () => container.querySelector(".calendar-frame") !== null,
    "Calendar loading shell",
  );
  assert.ok(container.querySelector(".calendar-frame"));
  assert.ok(container.querySelector(".calendar-grid"));
  assert.doesNotMatch(container.textContent ?? "", /正在读取 Calendar/);
  assert.equal(container.querySelectorAll(".calendar-day-marker").length, 0);
  root.unmount();
  env.restore();
});

test("Home saves an edited L paper, updates only L preview, and restores trigger focus", async (t) => {
  const env = installDom(true);
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const writes: Array<{ path: string; init: RequestInit }> = [];
  t.after(async () => {
    try { await React.act(async () => { root.unmount(); }); }
    finally { env.restore(); }
  });
  env.dom.window.localStorage.clear();
  await React.act(async () => {
    root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, {
      now: () => new Date(2026, 7, 12, 12, 0, 0),
      api: { request: async (path: string, init?: RequestInit) => {
        if (path === "/todo/dates" || path === "/diary/dates") return { success: true, data: { dates: [] } };
        if (init?.method === "PUT") {
          writes.push({ path, init });
          return { success: true, data: { author: "L", date: "2026-08-12", revision: 2, entries: JSON.parse(String(init.body)).entries } };
        }
        return { success: true, data: { date: "2026-08-12", papers: { L: { author: "L", date: "2026-08-12", revision: 1, entries: L_TODO_ENTRIES.map(entry => ({ ...entry })) }, G: { author: "G", date: "2026-08-12", revision: 1, entries: G_TODO_ENTRIES.map(entry => ({ ...entry })) }, C: { author: "C", date: "2026-08-12", revision: 1, entries: C_TODO_ENTRIES.map(entry => ({ ...entry })) } } } };
      } },
    })));
  });
  const lPanel = container.querySelector<HTMLButtonElement>(".today-panel-l")!;
  const gPanel = container.querySelector<HTMLButtonElement>(".today-panel-g")!;
  const cPanel = container.querySelector<HTMLButtonElement>(".today-panel-c")!;
  const gPreviewBefore = gPanel.textContent;
  const cPreviewBefore = cPanel.textContent;
  await React.act(async () => { lPanel.focus(); lPanel.click(); });
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(document.body.style.overflow, "hidden");
  assert.equal(dialog.querySelector('button[aria-label*="关闭"]'), null);
  const firstStatus = dialog.querySelector<HTMLButtonElement>(".todo-paper-status");
  assert.ok(firstStatus);
  await React.act(async () => { firstStatus.click(); });
  assert.equal(firstStatus.dataset.kind, "completed");
  const veil = container.querySelector<HTMLButtonElement>(".paper-detail-veil");
  assert.ok(veil);
  await React.act(async () => { veil.click(); });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/todo/2026-08-12/L");
  assert.equal(JSON.parse(String(writes[0].init.body)).entries[0].kind, "completed");
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(document.body.style.overflow, "");
  await waitForCondition(() => env.dom.window.document.activeElement === lPanel, "L trigger focus restoration");
  assert.ok(container.querySelector(".today-panel-l .today-note")?.classList.contains("today-note-completed"));
  assert.equal(gPanel.textContent, gPreviewBefore);
  assert.equal(cPanel.textContent, cPreviewBefore);
});

test("mobile top bar uses the approved Home geometry globally", () => {
  assert.match(stylesSource, /\.mobile-top-bar\s*\{[\s\S]*?min-height:\s*calc\(44px \+ env\(safe-area-inset-top,\s*0px\)\)[\s\S]*?height:\s*calc\(44px \+ env\(safe-area-inset-top,\s*0px\)\)[\s\S]*?border-bottom:\s*0[\s\S]*?background:\s*#ffffff[\s\S]*?backdrop-filter:\s*none/);
  assert.match(stylesSource, /\.mobile-top-bar-title\s*\{[\s\S]*?top:\s*calc\(env\(safe-area-inset-top,\s*0px\) \+ 8px\)[\s\S]*?font-family:\s*-apple-system[\s\S]*?font-size:\s*20px/);
  assert.match(stylesSource, /\.mobile-menu-button,\s*\.mobile-search-link\s*\{[\s\S]*?top:\s*calc\(env\(safe-area-inset-top,\s*0px\) \+ 0px\)[\s\S]*?width:\s*44px[\s\S]*?height:\s*44px/);
  assert.match(stylesSource, /\.mobile-menu-button\s*\{[\s\S]*?left:\s*18px/);
  assert.match(stylesSource, /\.mobile-search-link\s*\{[\s\S]*?right:\s*18px/);
  assert.match(stylesSource, /\.mobile-menu-icon\s*\{[\s\S]*?width:\s*22px/);
  assert.match(stylesSource, /\.mobile-search-link svg\s*\{[\s\S]*?width:\s*25px[\s\S]*?height:\s*25px[\s\S]*?stroke-width:\s*1\.8/);
  assert.doesNotMatch(stylesSource, /body:has\(\.home-prototype\) \.mobile-top-bar/);
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
  assert.match(
    stylesSource,
    /\.paper-detail-paper\s*\{[^}]*height:\s*clamp\(536px,\s*calc\(78dvh - 24px\),\s*696px\)/,
  );
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
  assert.match(stylesSource, /\.home-page-title\s*\{[^}]*font-weight:\s*500/);
  assert.match(
    stylesSource,
    /\.mobile-top-bar-title\s*\{[^}]*font-weight:\s*500/,
  );
  assert.match(
    stylesSource,
    /\.mobile-drawer-header strong\s*\{[^}]*font-weight:\s*500/,
  );
  assert.match(
    stylesSource,
    /\.home-section-heading h2\s*\{[^}]*font-weight:\s*500/,
  );
  assert.doesNotMatch(stylesSource, /\.records-section|\.home-bottom-nav/);
  assert.match(
    stylesSource,
    /\.home-page-title,\s*\.calendar-section-heading h2\s*\{[^}]*transform:\s*translateY\(-2px\)/,
  );
  assert.match(
    stylesSource,
    /\.today-panel-notes\s*\{[^}]*grid-row:\s*1 \/ -1[^}]*align-self:\s*center[^}]*height:\s*60px[^}]*margin-top:\s*0[^}]*overflow:\s*hidden/,
  );
  assert.match(stylesSource, /\.today-note\s*\{[^}]*font-size:\s*14\.5px/);
  assert.doesNotMatch(
    stylesSource,
    /\.today-note:nth-child\(3\)/,
  );
  assert.match(stylesSource, /\.calendar-weekdays\s*\{[^}]*font-size:\s*12px/);
  assert.match(
    stylesSource,
    /\.calendar-frame > \*\s*\{[^}]*position:\s*relative[^}]*z-index:\s*1[^}]*transform:\s*translateY\(-1px\)/,
  );
  assert.match(
    stylesSource,
    /\.calendar-weekdays,\s*\.calendar-grid\s*\{[^}]*transform:\s*translateY\(-1px\)/,
  );
  assert.match(
    stylesSource,
    /\.calendar-weekdays,\s*\.calendar-grid\s*\{[^}]*transform:\s*translateY\(-1px\)/,
  );
  assert.match(
    stylesSource,
    /\.home-prototype\s*\{[^}]*padding:\s*18px 0/,
  );
  assert.match(
    stylesSource,
    /\.today-panel\s*\{[^}]*height:\s*104px[^}]*min-height:\s*104px/,
  );
  assert.match(stylesSource, /\.mobile-top-bar-title[\s\S]*?left:\s*50%[\s\S]*?transform:\s*translateX\(-50%\)/);
  assert.match(stylesSource, /min-width:\s*44px/);
  assert.match(stylesSource, /:focus-visible/);
  assert.match(stylesSource, /html:has\(\.home-prototype\)[\s\S]*?#root:has\(\.home-prototype\)/);
  assert.doesNotMatch(stylesSource, /\.home-prototype[\s\S]*?hero-panel|\.home-prototype[\s\S]*?orbit/);
  assert.doesNotMatch(homeV2Styles, /background(?:-image)?:\s*(?:radial-gradient|linear-gradient|color-mix)/);
});


test("Home cards share one visual surface and press feedback", () => {
  assert.match(
    stylesSource,
    /\.today-panel\s*\{[^}]*border:\s*1px solid rgba\(0,\s*0,\s*0,\s*0\.11\)[^}]*border-radius:\s*14px[^}]*background:\s*#ffffff[^}]*box-shadow:\s*0 10px 28px rgba\(0,\s*0,\s*0,\s*0\.055\)[^}]*transition:\s*transform 120ms ease,\s*box-shadow 120ms ease/,
  );
  assert.match(
    stylesSource,
    /\.calendar-frame\s*\{[^}]*border-radius:\s*14px[^}]*background:\s*#ffffff[^}]*box-shadow:\s*0 10px 28px rgba\(0,\s*0,\s*0,\s*0\.055\)/,
  );
  assert.match(
    stylesSource,
    /\.calendar-frame::before\s*\{[^}]*border:\s*1px solid rgba\(0,\s*0,\s*0,\s*0\.11\)[^}]*border-radius:\s*14px/,
  );
});


test("Home and Todo editor reuse semantic CSS status marks", () => {
  assert.match(
    stylesSource,
    /\.today-note-mark,\s*\.todo-paper-status\s*\{[^}]*width:\s*22px[^}]*flex:\s*0 0 22px/,
  );
  assert.match(
    stylesSource,
    /\.today-note-mark\[data-kind="pending"\] > span,\s*\.todo-paper-status\[data-kind="pending"\] > span\s*\{[^}]*width:\s*14px[^}]*height:\s*14px[^}]*border:\s*1px solid/,
  );
  assert.match(
    stylesSource,
    /\.today-note-mark\[data-kind="completed"\] > span,\s*\.todo-paper-status\[data-kind="completed"\] > span\s*\{[^}]*width:\s*14px[^}]*height:\s*14px[^}]*background:/,
  );
  assert.match(
    stylesSource,
    /\.today-note-mark\[data-kind="completed"\] > span::after,\s*\.todo-paper-status\[data-kind="completed"\] > span::after\s*\{[^}]*border-color:\s*#ffffff[^}]*transform:\s*rotate\(45deg\)/,
  );
  assert.match(
    stylesSource,
    /\.today-note-mark\[data-kind="record"\] > span,\s*\.todo-paper-status\[data-kind="record"\] > span\s*\{[^}]*width:\s*8px[^}]*height:\s*8px/,
  );
  assert.match(
    stylesSource,
    /\.todo-paper-row\s*\{[^}]*grid-template-columns:\s*22px minmax\(0,\s*1fr\)[^}]*min-height:\s*30px/,
  );
  assert.match(
    stylesSource,
    /\.todo-paper-row textarea\s*\{[^}]*resize:\s*none[^}]*border:\s*0[^}]*background:\s*transparent[^}]*font:\s*inherit/,
  );
});
