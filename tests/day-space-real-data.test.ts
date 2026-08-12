import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { MemoryRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import { DaySpacePageContent } from "../web/src/pages/DaySpacePage.js";
import type { DaySpaceApi } from "../web/src/pages/day-space-api.js";

async function render(api: DaySpaceApi) {
  const dom = new JSDOM("<main id=\"root\"></main>", {
    url: "https://leilei-os.test/day-space?date=2026-08-12",
  });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const install = (name: PropertyKey, value: unknown) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const [name, value] of [
    ["window", dom.window],
    ["document", dom.window.document],
    ["navigator", dom.window.navigator],
    ["HTMLElement", dom.window.HTMLElement],
    ["HTMLButtonElement", dom.window.HTMLButtonElement],
    ["Node", dom.window.Node],
    ["Event", dom.window.Event],
    ["MouseEvent", dom.window.MouseEvent],
    ["React", React],
    ["IS_REACT_ACT_ENVIRONMENT", true],
  ] as const) install(name, value);
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(Date.now()), 0);
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  dom.window.scrollTo = () => {};
  const container = dom.window.document.querySelector("#root")!;
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: ["/day-space?date=2026-08-12"] }, React.createElement(DaySpacePageContent, { api })));
  });
  return {
    container,
    async settle() { await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); },
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

function apiWithDiaryFailure(onTodoLoad: () => void, onDiaryLoad: () => void): DaySpaceApi {
  return {
    webClient: { request: async () => ({}) } as never,
    listTodoDates: async () => [],
    loadTodoDay: async (date) => {
      onTodoLoad();
      return { date, papers: { L: null, G: null } };
    },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => {
      onDiaryLoad();
      throw new Error("diary unavailable");
    },
    updateDiary: async () => { throw new Error("not used"); },
  };
}

test("Day Space retries only the failed Diary module", async () => {
  let todoLoads = 0;
  let diaryLoads = 0;
  const page = await render(apiWithDiaryFailure(() => { todoLoads += 1; }, () => { diaryLoads += 1; }));
  await page.settle();
  assert.match(page.container.textContent ?? "", /部分 Day Space 内容暂时无法读取/);
  const retry = [...page.container.querySelectorAll<HTMLButtonElement>(".day-space-warning button")]
    .find((button) => button.textContent === "重试 Diary");
  assert.ok(retry);
  await React.act(async () => { retry.click(); });
  await page.settle();
  assert.equal(todoLoads, 1);
  assert.equal(diaryLoads, 2);
  await page.cleanup();
});
