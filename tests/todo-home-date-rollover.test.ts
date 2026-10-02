import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { BrowserRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import { DashboardPageContent } from "../web/src/pages/DashboardPage..js";
import { formatTodoStorageDate } from "../web/src/pages/todo-paper-storage.js";

test("Todo business dates use the device-local calendar date", () => {
  assert.equal(formatTodoStorageDate(new Date(2026, 1, 28, 23, 59)), "2026-02-28");
  assert.equal(formatTodoStorageDate(new Date(2024, 1, 29, 12, 0)), "2024-02-29");
});

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://leilei.test/" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "React"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "React" ? React : dom.window[key as keyof Window] });
  }
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
  return {
    dom,
    restore() {
      for (const key of ["window", "document", "navigator", "React"]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
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

function dayResponse(date: string, label: string) {
  return {
    success: true,
    data: {
      date,
      papers: {
        L: { author: "L", date, revision: 1, entries: [{ id: `l-${date}`, kind: "record", text: label }] },
        G: null,
        C: null,
      },
    },
  };
}

test("foreground date change loads the new local day without carrying yesterday's entries", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  let currentDate = new Date(2026, 7, 12, 9, 0);
  const now = () => currentDate;
  const requests: string[] = [];
  const api = { request: async (path: string) => {
    requests.push(path);
    if (path === "/todo/dates" || path === "/diary/dates") return { success: true, data: { dates: [] } };
    return dayResponse(path.split("/").at(-1)!, path.includes("2026-08-13") ? "today" : "yesterday");
  } };
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, { api, now })));
  await waitForCondition(
    () =>
      requests.includes("/todo/2026-08-12") &&
      /yesterday/.test(container.textContent ?? ""),
    "initial yesterday Todo paper",
  );
  currentDate = new Date(2026, 7, 13, 9, 0);
  env.dom.window.dispatchEvent(new env.dom.window.Event("focus"));
  await waitForCondition(
    () =>
      requests.includes("/todo/2026-08-13") &&
      /today/.test(container.textContent ?? "") &&
      !/yesterday/.test(container.textContent ?? ""),
    "new local date Todo paper",
  );
  assert.match(container.textContent ?? "", /today/);
  assert.doesNotMatch(container.textContent ?? "", /yesterday/);
  assert.deepEqual(requests, ["/todo/2026-08-12", "/todo/dates", "/diary/dates", "/todo/2026-08-13"]);
  await React.act(async () => { root.unmount(); });
  await waitForPaint();
  env.restore();
});

test("dirty paper defers date rebinding and loads the newest date after close", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  let currentDate = new Date(2026, 7, 12, 9, 0);
  const now = () => currentDate;
  const requests: string[] = [];
  const api = { request: async (path: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (init?.method === "PUT") return { success: true, data: { author: "L", date: "2026-08-12", revision: 2, entries: [{ id: "old", kind: "record", text: "saved" }] } };
    if (path === "/todo/dates" || path === "/diary/dates") return { success: true, data: { dates: [] } };
    return dayResponse(path.split("/").at(-1)!, path.includes("2026-08-13") ? "today" : "yesterday");
  } };
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, { api, now })));
  await waitForPaint();
  const panel = container.querySelector<HTMLButtonElement>(".today-panel-l")!;
  panel.click();
  await waitForPaint();
  container.querySelector<HTMLButtonElement>(".todo-paper-status")!.click();
  await waitForPaint();
  currentDate = new Date(2026, 7, 13, 9, 0);
  env.dom.window.dispatchEvent(new env.dom.window.Event("focus"));
  await waitForPaint();
  assert.match(container.textContent ?? "", /yesterday/);
  assert.doesNotMatch(container.textContent ?? "", /today/);
  container.querySelector<HTMLButtonElement>(".paper-detail-veil")!.click();
  await waitForPaint();
  await waitForPaint();
  assert.match(container.textContent ?? "", /today/);
  assert.deepEqual(requests, ["GET /todo/2026-08-12", "GET /todo/dates", "GET /diary/dates", "PUT /todo/2026-08-12/L", "GET /todo/dates", "GET /diary/dates", "GET /todo/2026-08-13"]);
  await React.act(async () => { root.unmount(); });
  await waitForPaint();
  env.restore();
});

test("a dirty C paper defers the day switch until its close saves it", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  let currentDate = new Date(2026, 7, 12, 9, 0);
  const now = () => currentDate;
  const requests: string[] = [];
  const api = { request: async (path: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${path}`);
    if (init?.method === "PUT") {
      return { success: true, data: { author: "C", date: "2026-08-12", revision: 2, entries: [{ id: "c-old", kind: "completed", text: "saved C" }] } };
    }
    if (path === "/todo/dates" || path === "/diary/dates") return { success: true, data: { dates: [] } };
    return {
      success: true,
      data: {
        date: path.split("/").at(-1)!,
        papers: {
          L: null,
          G: null,
          C: { author: "C", date: path.split("/").at(-1)!, revision: 1, entries: [{ id: `c-${path}`, kind: "record", text: path.includes("2026-08-13") ? "C today" : "C yesterday" }] },
        },
      },
    };
  } };
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, { api, now })));
  await waitForCondition(() => /C yesterday/.test(container.textContent ?? ""), "initial C Todo paper");
  container.querySelector<HTMLButtonElement>(".today-panel-c")!.click();
  await waitForPaint();
  container.querySelector<HTMLButtonElement>(".todo-paper-status")!.click();
  await waitForPaint();
  currentDate = new Date(2026, 7, 13, 9, 0);
  env.dom.window.dispatchEvent(new env.dom.window.Event("focus"));
  await waitForPaint();
  assert.match(container.textContent ?? "", /C yesterday/);
  assert.doesNotMatch(container.textContent ?? "", /C today/);
  container.querySelector<HTMLButtonElement>(".paper-detail-veil")!.click();
  await waitForCondition(() => /C today/.test(container.textContent ?? ""), "new C Todo paper after close");
  assert.ok(requests.includes("PUT /todo/2026-08-12/C"));
  await React.act(async () => { root.unmount(); });
  await waitForPaint();
  env.restore();
});

test("a stale old-day success cannot overwrite the newer day", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  let currentDate = new Date(2026, 7, 12, 9, 0);
  const now = () => currentDate;
  let resolveOld!: (value: unknown) => void;
  let resolveNew!: (value: unknown) => void;
  const old = new Promise((resolve) => { resolveOld = resolve; });
  const newer = new Promise((resolve) => { resolveNew = resolve; });
  const api = { request: (path: string) => {
    if (path === "/todo/dates" || path === "/diary/dates") return Promise.resolve({ success: true, data: { dates: [] } });
    return path.endsWith("2026-08-12") ? old : newer;
  } };
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, { api, now })));
  await waitForPaint();
  currentDate = new Date(2026, 7, 13, 9, 0);
  env.dom.window.dispatchEvent(new env.dom.window.Event("focus"));
  resolveNew(dayResponse("2026-08-13", "new day"));
  await waitForPaint();
  assert.match(container.textContent ?? "", /new day/);
  resolveOld(dayResponse("2026-08-12", "old day"));
  await waitForPaint();
  assert.match(container.textContent ?? "", /new day/);
  assert.doesNotMatch(container.textContent ?? "", /old day/);
  await React.act(async () => { root.unmount(); });
  await waitForPaint();
  env.restore();
});

test("a stale old-day failure cannot turn a newer successful load into an error", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  let currentDate = new Date(2026, 7, 12, 9, 0);
  let rejectOld!: (error: Error) => void;
  let resolveNew!: (value: unknown) => void;
  const old = new Promise((_, reject) => { rejectOld = reject; });
  const newer = new Promise((resolve) => { resolveNew = resolve; });
  const api = { request: (path: string) => {
    if (path === "/todo/dates" || path === "/diary/dates") return Promise.resolve({ success: true, data: { dates: [] } });
    return path.endsWith("2026-08-12") ? old : newer;
  } };
  const now = () => currentDate;
  const root = createRoot(container);
  root.render(React.createElement(BrowserRouter, null, React.createElement(DashboardPageContent, { api, now })));
  await waitForPaint();
  currentDate = new Date(2026, 7, 13, 9, 0);
  env.dom.window.dispatchEvent(new env.dom.window.Event("focus"));
  resolveNew(dayResponse("2026-08-13", "new day"));
  await waitForPaint();
  assert.match(container.textContent ?? "", /new day/);
  rejectOld(new Error("stale failure"));
  await waitForPaint();
  assert.match(container.textContent ?? "", /new day/);
  assert.equal(container.querySelector(".home-todo-error"), null);
  await React.act(async () => { root.unmount(); });
  await waitForPaint();
  env.restore();
});
