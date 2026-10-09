import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { MemoryRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import { DaySpacePageContent } from "../web/src/pages/DaySpacePage.js";
import type { DaySpaceApi } from "../web/src/pages/day-space-api.js";

async function render(api: DaySpaceApi) {
  const original = api.webClient;
  api = {...api, webClient: {request: async <T>(path: string, init?: RequestInit) => {
    if (path.startsWith("/mind/days/")) return {data:{items:[], nextCursor:null}} as T;
    return original.request<T>(path, init);
  }}};
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
    ["HTMLInputElement", dom.window.HTMLInputElement],
    ["HTMLTextAreaElement", dom.window.HTMLTextAreaElement],
    ["InputEvent", dom.window.InputEvent],
    ["Node", dom.window.Node],
    ["Event", dom.window.Event],
    ["MouseEvent", dom.window.MouseEvent],
    ["React", React],
    ["IS_REACT_ACT_ENVIRONMENT", true],
  ] as const) install(name, value);
  (dom.window.HTMLElement.prototype as unknown as { attachEvent(name: string, listener: EventListener): void }).attachEvent = function (name, listener) {
    this.addEventListener(name.replace(/^on/, ""), listener);
  };
  (dom.window.HTMLElement.prototype as unknown as { detachEvent(name: string, listener: EventListener): void }).detachEvent = function (name, listener) {
    this.removeEventListener(name.replace(/^on/, ""), listener);
  };
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(Date.now()), 0);
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  dom.window.scrollTo = () => {};
  const container = dom.window.document.querySelector("#root")!;
  const { createRoot } = await import("../web/node_modules/react-dom/client.js");
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

function apiWithDiaryFailure(onTodoLoad: () => void, onDiaryLoad: () => void, onDiaryRetryPending: (resolve: (value: { date: string; diaries: [] }) => void) => void): DaySpaceApi {
  return {
    webClient: { request: async () => ({}) } as never,
    listTodoDates: async () => [],
    loadTodoDay: async (date) => {
      onTodoLoad();
      return { date, papers: { L: { author: "L", date, revision: 1, entries: [{ id: "todo-1", kind: "pending", text: "Keep Todo" }] }, G: null, C: null } };
    },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => {
      onDiaryLoad();
      if (diaryLoadsForTest === 1) throw new Error("diary unavailable");
      return new Promise((resolve) => onDiaryRetryPending(resolve));
    },
    updateDiary: async () => { throw new Error("not used"); },
  };
}

let diaryLoadsForTest = 0;

const date = "2026-08-12";
const todo = {
  date,
  papers: {
    L: { author: "L" as const, date, revision: 1, entries: [{ id: "todo-1", kind: "pending" as const, text: "Keep Todo" }] },
    G: null,
    C: null,
  },
};
const diary = {
  id: "diary-1",
  title: "Original diary",
  content: "Original content",
  date,
  author: "L" as const,
  tags: ["keep"],
  mood: "calm",
  created_at: "2026-08-12T01:00:00.000Z",
  updated_at: "2026-08-12T02:00:00.000Z",
};

type MountedPage = Awaited<ReturnType<typeof render>>;

function suppressAuthorPortal(page: MountedPage) {
  const documentQuerySelector = page.container.ownerDocument.querySelector.bind(page.container.ownerDocument);
  page.container.ownerDocument.querySelector = ((selector: string) => {
    if (selector === ".paper-detail-layer .paper-detail-signature") return null;
    return documentQuerySelector(selector);
  }) as typeof page.container.ownerDocument.querySelector;
}

async function saveDiaryPaper(page: MountedPage, titleValue: string) {
  suppressAuthorPortal(page);
  const diaryPaper = page.container.querySelector<HTMLButtonElement>(".day-space-paper-diary");
  assert.ok(diaryPaper);
  await React.act(async () => { diaryPaper.click(); });
  await page.settle();
  const authorTrigger = page.container.querySelector<HTMLButtonElement>(".paper-author-signature-trigger");
  assert.ok(authorTrigger);
  await React.act(async () => { authorTrigger.click(); });
  const authorG = page.container.querySelector<HTMLButtonElement>('[role="menuitemradio"][data-author="G"]');
  assert.ok(authorG);
  await React.act(async () => { authorG.click(); });
  const title = page.container.querySelector<HTMLInputElement>("input[aria-label=\"日记标题\"]");
  assert.ok(title);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(title), "value")?.set?.call(title, titleValue);
    const change = new page.container.ownerDocument!.defaultView!.Event("propertychange", { bubbles: true });
    Object.defineProperty(change, "propertyName", { value: "value" });
    title.dispatchEvent(change);
    title.dispatchEvent(new page.container.ownerDocument!.defaultView!.InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
  });
  const save = [...page.container.querySelectorAll<HTMLButtonElement>(".memory-paper-control")]
    .find((button) => button.textContent === "保存");
  assert.ok(save);
  await React.act(async () => { save.dispatchEvent(new page.container.ownerDocument!.defaultView!.MouseEvent("click", { bubbles: true })); });
  await page.settle();
}

async function saveTodoPaper(page: MountedPage, textValue: string) {
  const todoPaper = page.container.querySelector<HTMLButtonElement>(".day-space-paper-todo");
  assert.ok(todoPaper);
  await React.act(async () => { todoPaper.click(); });
  await page.settle();
  const textarea = page.container.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(textarea);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")?.set?.call(textarea, textValue);
    textarea.dispatchEvent(new page.container.ownerDocument!.defaultView!.Event("input", { bubbles: true }));
  });
  const veil = page.container.querySelector<HTMLButtonElement>(".paper-detail-veil");
  assert.ok(veil);
  await React.act(async () => { veil.click(); });
  await page.settle();
}

test("Day Space retries only the failed Diary module", async () => {
  let todoLoads = 0;
  let diaryLoads = 0;
  let resolveDiaryRetry!: (value: { date: string; diaries: [] }) => void;
  diaryLoadsForTest = 0;
  const page = await render(apiWithDiaryFailure(() => { todoLoads += 1; }, () => { diaryLoads += 1; diaryLoadsForTest += 1; }, (resolve) => { resolveDiaryRetry = resolve; }));
  await page.settle();
  assert.match(page.container.textContent ?? "", /部分 Day Space 内容暂时无法读取/);
  assert.ok(page.container.querySelector(".day-space-paper-todo"));
  const retry = [...page.container.querySelectorAll<HTMLButtonElement>(".day-space-warning button")]
    .find((button) => button.textContent === "重试 Diary");
  assert.ok(retry);
  await React.act(async () => { retry.click(); });
  assert.equal(todoLoads, 1);
  assert.equal(diaryLoads, 2);
  assert.ok(page.container.querySelector(".day-space-paper-todo"));
  resolveDiaryRetry({ date: "2026-08-12", diaries: [] });
  await page.settle();
  await page.cleanup();
});

test("Day Space retains committed Diary and Todo through refresh failure, then recovers", async () => {
  let todoLoads = 0;
  let diaryLoads = 0;
  let rejectDiaryRefresh!: (reason?: unknown) => void;
  const committedDiary = { ...diary, title: "Committed diary" };
  const freshDiary = { ...diary, title: "Fresh diary" };
  const api: DaySpaceApi = {
    webClient: { request: async <T>(path: string, init?: RequestInit) => {
      if (init?.method === "PUT") return { success: true, data: { ...todo.papers.L, entries: [{ id: "todo-1", kind: "pending", text: "Committed Todo" }] } } as T;
      throw new Error(`unexpected request ${path}`);
    } },
    listTodoDates: async () => [],
    loadTodoDay: async () => {
      todoLoads += 1;
      if (todoLoads === 1) return todo;
      if (todoLoads === 2) return new Promise(() => {});
      return todo;
    },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => {
      diaryLoads += 1;
      if (diaryLoads === 1) return { date, diaries: [diary] };
      if (diaryLoads === 2) return new Promise((_, reject) => { rejectDiaryRefresh = reject; });
      return { date, diaries: [freshDiary] };
    },
    updateDiary: async () => committedDiary,
  };
  const page = await render(api);
  await page.settle();
  const diaryPaper = page.container.querySelector<HTMLButtonElement>(".day-space-paper-diary");
  assert.ok(diaryPaper);
  const documentQuerySelector = page.container.ownerDocument.querySelector.bind(page.container.ownerDocument);
  page.container.ownerDocument.querySelector = ((selector: string) => {
    if (selector === ".paper-detail-layer .paper-detail-signature") return null;
    return documentQuerySelector(selector);
  }) as typeof page.container.ownerDocument.querySelector;
  await React.act(async () => { diaryPaper.click(); });
  await page.settle();
  const authorTrigger = page.container.querySelector<HTMLButtonElement>(".paper-author-signature-trigger");
  assert.ok(authorTrigger);
  await React.act(async () => { authorTrigger.click(); });
  const authorG = page.container.querySelector<HTMLButtonElement>('[role="menuitemradio"][data-author="G"]');
  assert.ok(authorG);
  await React.act(async () => { authorG.click(); });
  const title = page.container.querySelector<HTMLInputElement>("input[aria-label=\"日记标题\"]");
  assert.ok(title);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(title), "value")?.set?.call(title, "Committed diary");
    const change = new page.container.ownerDocument!.defaultView!.Event("propertychange", { bubbles: true });
    Object.defineProperty(change, "propertyName", { value: "value" });
    title.dispatchEvent(change);
    title.dispatchEvent(new page.container.ownerDocument!.defaultView!.InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
  });
  const save = [...page.container.querySelectorAll<HTMLButtonElement>(".memory-paper-control")]
    .find((button) => button.textContent === "保存");
  assert.ok(save);
  assert.equal(title.value, "Committed diary");
  assert.equal(page.container.querySelector<HTMLTextAreaElement>("textarea[aria-label=\"日记正文\"]")?.value, "Original content");
  assert.equal(save.disabled, false, save.outerHTML);
  await React.act(async () => { save.dispatchEvent(new page.container.ownerDocument!.defaultView!.MouseEvent("click", { bubbles: true })); });
  await page.settle();
  assert.equal(typeof rejectDiaryRefresh, "function");
  rejectDiaryRefresh(new Error("Diary refresh unavailable"));
  await page.settle();
  assert.match(page.container.textContent ?? "", /Committed diary/);
  assert.ok(page.container.querySelector(".day-space-paper-todo"));
  const retryDiary = [...page.container.querySelectorAll<HTMLButtonElement>(".day-space-warning button")]
    .find((button) => button.textContent === "重试 Diary");
  assert.ok(retryDiary);
  await React.act(async () => { retryDiary.click(); });
  await page.settle();
  assert.match(page.container.textContent ?? "", /Fresh diary/);
  assert.equal(page.container.querySelector(".day-space-warning"), null);
  assert.equal(todoLoads, 1);
  assert.equal(diaryLoads, 3);
  await page.cleanup();
});

test("Day Space retains committed Todo through refresh failure, then recovers", async () => {
  let todoLoads = 0;
  let diaryLoads = 0;
  let rejectTodoRefresh!: (reason?: unknown) => void;
  const committedTodo = { ...todo.papers.L!, entries: [{ id: "todo-1", kind: "pending" as const, text: "Committed Todo" }] };
  const freshTodo = { ...todo.papers.L!, entries: [{ id: "todo-1", kind: "pending" as const, text: "Fresh Todo" }] };
  const api: DaySpaceApi = {
    webClient: {
      request: async <T>(path: string, init?: RequestInit) => {
        if (path === "/todo/2026-08-12/L" && init?.method === "PUT") {
          return { success: true, data: committedTodo } as T;
        }
        throw new Error(`unexpected request ${path}`);
      },
    },
    listTodoDates: async () => [],
    loadTodoDay: async () => {
      todoLoads += 1;
      if (todoLoads === 1) return todo;
      if (todoLoads === 2) return new Promise((_, reject) => { rejectTodoRefresh = reject; });
      return { date, papers: { L: freshTodo, G: null, C: null } };
    },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => {
      diaryLoads += 1;
      return { date, diaries: [diary] };
    },
    updateDiary: async () => { throw new Error("not used"); },
  };
  const page = await render(api);
  await page.settle();
  const todoPaper = page.container.querySelector<HTMLButtonElement>(".day-space-paper-todo");
  assert.ok(todoPaper);
  await React.act(async () => { todoPaper.click(); });
  await page.settle();
  const textarea = page.container.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(textarea);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")?.set?.call(textarea, "Committed Todo");
    textarea.dispatchEvent(new page.container.ownerDocument!.defaultView!.Event("input", { bubbles: true }));
  });
  const veil = page.container.querySelector<HTMLButtonElement>(".paper-detail-veil");
  assert.ok(veil);
  await React.act(async () => { veil.click(); });
  await page.settle();
  assert.equal(typeof rejectTodoRefresh, "function");
  rejectTodoRefresh(new Error("Todo refresh unavailable"));
  await page.settle();
  assert.match(page.container.textContent ?? "", /Committed Todo/);
  assert.ok(page.container.querySelector(".day-space-paper-diary"));
  const retryTodo = [...page.container.querySelectorAll<HTMLButtonElement>(".day-space-warning button")]
    .find((button) => button.textContent === "重试 Todo");
  assert.ok(retryTodo);
  await React.act(async () => { retryTodo.click(); });
  await page.settle();
  assert.match(page.container.textContent ?? "", /Fresh Todo/);
  assert.equal(page.container.querySelector(".day-space-warning"), null);
  assert.equal(todoLoads, 3);
  assert.equal(diaryLoads, 1);
  await page.cleanup();
});

test("Day Space opens C Todo, retains its committed C slot on refresh failure, and offers Todo retry", async () => {
  let todoLoads = 0;
  let rejectTodoRefresh!: (reason?: unknown) => void;
  const cTodo = { author: "C" as const, date, revision: 1, entries: [{ id: "c-1", kind: "pending" as const, text: "C Todo" }] };
  const committedC = { ...cTodo, revision: 2, entries: [{ id: "c-1", kind: "pending" as const, text: "Committed C Todo" }] };
  const api: DaySpaceApi = {
    webClient: {
      request: async <T>(path: string, init?: RequestInit) => {
        assert.equal(path, "/todo/2026-08-12/C");
        assert.equal(init?.method, "PUT");
        return { success: true, data: committedC } as T;
      },
    },
    listTodoDates: async () => [],
    loadTodoDay: async () => {
      todoLoads += 1;
      if (todoLoads === 1) return { date, papers: { L: null, G: null, C: cTodo } };
      return new Promise((_, reject) => { rejectTodoRefresh = reject; });
    },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => ({ date, diaries: [] }),
    updateDiary: async () => { throw new Error("not used"); },
  };
  const page = await render(api);
  await page.settle();
  assert.equal(page.container.querySelector(".day-space-paper-signature")?.textContent, "C");
  await saveTodoPaper(page, "Committed C Todo");
  assert.equal(typeof rejectTodoRefresh, "function");
  rejectTodoRefresh(new Error("Todo refresh unavailable"));
  await page.settle();
  assert.match(page.container.textContent ?? "", /Committed C Todo/);
  assert.match(page.container.textContent ?? "", /重试 Todo/);
  await page.cleanup();
});

test("Day Space treats C Todo as content when deciding whether the day is empty", async () => {
  const api: DaySpaceApi = {
    webClient: { request: async () => ({}) } as never,
    listTodoDates: async () => [],
    loadTodoDay: async () => ({
      date,
      papers: {
        L: null,
        G: null,
        C: { author: "C", date, revision: 1, entries: [{ id: "c-1", kind: "pending", text: "C only" }] },
      },
    }),
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => ({ date, diaries: [] }),
    updateDiary: async () => { throw new Error("not used"); },
  };
  const page = await render(api);
  await page.settle();
  assert.match(page.container.textContent ?? "", /C only/);
  assert.doesNotMatch(page.container.textContent ?? "", /这一天还没有内容/);
  await page.cleanup();
});

test("Day Space keeps C selected for Diary and preserves metadata when changing it to G", async () => {
  const cDiary = { ...diary, author: "C" as const, tags: ["keep", "c"], mood: "focused" };
  let updateInput: Parameters<DaySpaceApi["updateDiary"]>[0] | undefined;
  const api: DaySpaceApi = {
    webClient: { request: async () => ({}) } as never,
    listTodoDates: async () => [],
    loadTodoDay: async () => ({ date, papers: { L: null, G: null, C: null } }),
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => ({ date, diaries: [cDiary] }),
    updateDiary: async (input) => {
      updateInput = input;
      return { ...cDiary, ...input };
    },
  };
  const page = await render(api);
  await page.settle();
  assert.equal(page.container.querySelector(".day-space-paper-signature")?.textContent, "C");
  suppressAuthorPortal(page);
  await saveDiaryPaper(page, "C becomes G");
  assert.deepEqual(updateInput, {
    id: cDiary.id,
    title: "C becomes G",
    content: cDiary.content,
    author: "G",
    date: cDiary.date,
    tags: cDiary.tags,
    mood: cDiary.mood,
  });
  await page.cleanup();
});

test("Day Space keeps an emptied committed Todo paper absent after refresh failure", async () => {
  let todoLoads = 0;
  let rejectTodoRefresh!: (reason?: unknown) => void;
  const api: DaySpaceApi = {
    webClient: {
      request: async <T>(path: string, init?: RequestInit) => {
        if (path === "/todo/2026-08-12/L" && init?.method === "PUT") {
          return { success: true, data: { author: "L", date, revision: 2, entries: [] } } as T;
        }
        throw new Error(`unexpected request ${path}`);
      },
    },
    listTodoDates: async () => [],
    loadTodoDay: async () => {
      todoLoads += 1;
      if (todoLoads === 1) return todo;
      if (todoLoads === 2) return new Promise((_, reject) => { rejectTodoRefresh = reject; });
      return { date, papers: { L: null, G: null, C: null } };
    },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => ({ date, diaries: [diary] }),
    updateDiary: async () => { throw new Error("not used"); },
  };
  const page = await render(api);
  await page.settle();
  const todoPaper = page.container.querySelector<HTMLButtonElement>(".day-space-paper-todo");
  assert.ok(todoPaper);
  await React.act(async () => { todoPaper.click(); });
  await page.settle();
  const textarea = page.container.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(textarea);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")?.set?.call(textarea, "");
    textarea.dispatchEvent(new page.container.ownerDocument!.defaultView!.Event("input", { bubbles: true }));
  });
  const veil = page.container.querySelector<HTMLButtonElement>(".paper-detail-veil");
  assert.ok(veil);
  await React.act(async () => { veil.click(); });
  await page.settle();
  assert.equal(typeof rejectTodoRefresh, "function");
  rejectTodoRefresh(new Error("Todo refresh unavailable"));
  await page.settle();
  assert.equal(page.container.querySelector(".day-space-paper-todo"), null);
  assert.ok(page.container.querySelector(".day-space-paper-diary"));
  assert.ok(page.container.querySelector(".day-space-warning"));
  await page.cleanup();
});

test("Day Space keeps both retained modules visible when both refreshes fail", async () => {
  let todoLoads = 0;
  let diaryLoads = 0;
  let rejectDiaryRefresh!: (reason?: unknown) => void;
  let rejectTodoRefresh!: (reason?: unknown) => void;
  const committedDiary = { ...diary, title: "Committed Diary" };
  const committedTodo = { ...todo.papers.L!, entries: [{ id: "todo-1", kind: "pending" as const, text: "Committed Todo" }] };
  const api: DaySpaceApi = {
    webClient: {
      request: async <T>(path: string, init?: RequestInit) => {
        if (path === "/todo/2026-08-12/L" && init?.method === "PUT") return { success: true, data: committedTodo } as T;
        throw new Error(`unexpected request ${path}`);
      },
    },
    listTodoDates: async () => [],
    loadTodoDay: async () => {
      todoLoads += 1;
      if (todoLoads === 1) return todo;
      return new Promise((_, reject) => { rejectTodoRefresh = reject; });
    },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => {
      diaryLoads += 1;
      if (diaryLoads === 1) return { date, diaries: [diary] };
      return new Promise((_, reject) => { rejectDiaryRefresh = reject; });
    },
    updateDiary: async () => committedDiary,
  };
  const page = await render(api);
  await page.settle();
  await saveDiaryPaper(page, "Committed Diary");
  assert.equal(typeof rejectDiaryRefresh, "function");
  rejectDiaryRefresh(new Error("Diary refresh unavailable"));
  await page.settle();
  await saveTodoPaper(page, "Committed Todo");
  assert.equal(typeof rejectTodoRefresh, "function");
  rejectTodoRefresh(new Error("Todo refresh unavailable"));
  await page.settle();
  assert.match(page.container.textContent ?? "", /Committed Diary/);
  assert.match(page.container.textContent ?? "", /Committed Todo/);
  assert.match(page.container.textContent ?? "", /部分 Day Space 内容暂时无法读取/);
  assert.match(page.container.textContent ?? "", /重试 Todo/);
  assert.match(page.container.textContent ?? "", /重试 Diary/);
  assert.doesNotMatch(page.container.textContent ?? "", /Unable to read Day Space\./);
  assert.equal(todoLoads, 2);
  assert.equal(diaryLoads, 2);
  await page.cleanup();
});

test("Day Space keeps one retained module visible when both modules fail", async () => {
  let diaryLoads = 0;
  let rejectDiaryRefresh!: (reason?: unknown) => void;
  const committedDiary = { ...diary, title: "Only retained Diary" };
  const api: DaySpaceApi = {
    webClient: { request: async () => ({}) } as never,
    listTodoDates: async () => [],
    loadTodoDay: async () => { throw new Error("Todo unavailable"); },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => {
      diaryLoads += 1;
      if (diaryLoads === 1) return { date, diaries: [diary] };
      return new Promise((_, reject) => { rejectDiaryRefresh = reject; });
    },
    updateDiary: async () => committedDiary,
  };
  const page = await render(api);
  await page.settle();
  await saveDiaryPaper(page, "Only retained Diary");
  assert.equal(typeof rejectDiaryRefresh, "function");
  rejectDiaryRefresh(new Error("Diary refresh unavailable"));
  await page.settle();
  assert.match(page.container.textContent ?? "", /Only retained Diary/);
  assert.match(page.container.textContent ?? "", /部分 Day Space 内容暂时无法读取/);
  assert.match(page.container.textContent ?? "", /重试 Todo/);
  assert.match(page.container.textContent ?? "", /重试 Diary/);
  assert.doesNotMatch(page.container.textContent ?? "", /Unable to read Day Space\./);
  await page.cleanup();
});

test("Day Space shows full failure only when both modules have no retained value", async () => {
  const api: DaySpaceApi = {
    webClient: { request: async () => ({}) } as never,
    listTodoDates: async () => [],
    loadTodoDay: async () => { throw new Error("Todo unavailable"); },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => { throw new Error("Diary unavailable"); },
    updateDiary: async () => { throw new Error("not used"); },
  };
  const page = await render(api);
  await page.settle();
  assert.match(page.container.textContent ?? "", /Unable to read Day Space\./);
  assert.doesNotMatch(page.container.textContent ?? "", /部分 Day Space 内容暂时无法读取/);
  assert.doesNotMatch(page.container.textContent ?? "", /Reading\.\.\./);
  await page.cleanup();
});

test("Day Space does not claim complete empty or loading when one failed source meets a known empty module", async () => {
  const api: DaySpaceApi = {
    webClient: { request: async () => ({}) } as never,
    listTodoDates: async () => [],
    loadTodoDay: async () => ({ date, papers: { L: null, G: null, C: null } }),
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => { throw new Error("Diary unavailable"); },
    updateDiary: async () => { throw new Error("not used"); },
  };
  const page = await render(api);
  await page.settle();
  assert.match(page.container.textContent ?? "", /部分 Day Space 内容暂时无法读取/);
  assert.doesNotMatch(page.container.textContent ?? "", /这一天还没有内容/);
  assert.doesNotMatch(page.container.textContent ?? "", /Reading\.\.\./);
  assert.doesNotMatch(page.container.textContent ?? "", /Unable to read Day Space\./);
  await page.cleanup();
});


test("Day Space loading and empty states use the shared module state surface", () => {
  const daySpaceSource = readFileSync(
    new URL("../web/src/pages/DaySpacePage.tsx", import.meta.url),
    "utf8",
  );
  const stylesSource = readFileSync(
    new URL("../web/src/styles.css", import.meta.url),
    "utf8",
  );

  assert.match(
    daySpaceSource,
    /<PageState state="loading" message="Reading\.\.\." \/>/,
  );
  assert.match(
    daySpaceSource,
    /<PageState state="loading" message="Reading\.\.\." \/>/,
  );
  assert.match(
    daySpaceSource,
    /<ModuleState state="empty" message="这一天还没有内容" className="day-space-stage-state" \/>/,
  );

  const stageStart = daySpaceSource.indexOf(
    '<div ref={stageMeasureRef} className="day-space-stage-measure">',
  );
  const discoveryLoading = daySpaceSource.indexOf('<PageState state="loading" message="Reading..."', stageStart);
  assert.ok(stageStart >= 0);
  assert.ok(discoveryLoading > stageStart);

  assert.match(
    stylesSource,
    /\.day-space-stage-state,[\s\S]*?\.day-space-placeholder\s*\{[^}]*margin:\s*64px auto 0[^}]*font-size:\s*13px[^}]*font-weight:\s*400[^}]*text-align:\s*center/s,
  );
});


test("Day Space search Retry uses the global Retry typography", () => {
  const stylesSource = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
  assert.match(
    stylesSource,
    /\.module-search-state > button:not\(\.secondary-button\)\s*\{[^}]*font-size:\s*11px[^}]*font-weight:\s*500[^}]*line-height:\s*1\.4[^}]*text-decoration:\s*none/s,
  );
});


test("Day Space creates a missing Todo paper through its existing editor, without changing the Home Todo page", async () => {
  let calls = 0;
  const saveRequests: Array<{ path: string; body: { revision: number | null; entries: Array<{ text: string }> } }> = [];
  const created = { author: "G" as const, date, revision: 1, entries: [{ id: "g-new", kind: "pending" as const, text: "Day Space entry" }] };
  const api: DaySpaceApi = {
    webClient: {
      request: async <T>(path: string, init?: RequestInit) => {
        if (path === "/todo/2026-08-12/G" && init?.method === "PUT") {
          saveRequests.push({ path, body: JSON.parse(String(init.body)) });
          return { success: true, data: created } as T;
        }
        throw new Error("Unexpected request: " + path);
      },
    },
    listTodoDates: async () => [],
    loadTodoDay: async () => {
      calls += 1;
      return { date, papers: { L: null, G: calls === 1 ? null : created, C: null } };
    },
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => ({ date, diaries: [] }),
    updateDiary: async () => { throw new Error("unexpected diary update"); },
  };
  const page = await render(api);
  await page.settle();
  assert.match(page.container.textContent ?? "", /这一天还没有内容/);
  const create = page.container.querySelector<HTMLButtonElement>('[aria-label="新增 Todo"]');
  assert.ok(create);
  assert.equal(create.disabled, false);
  await React.act(async () => { create.click(); });
  const choices = [...page.container.querySelectorAll<HTMLButtonElement>('.day-space-create-popover [role="menuitem"]')];
  assert.deepEqual(choices.map((button) => button.textContent?.trim()), ["L", "G", "C"]);
  // A real pointer fires mousedown before click; this must not dismiss the author menu.
  await React.act(async () => {
    choices[1]!.dispatchEvent(new page.container.ownerDocument.defaultView!.MouseEvent("mousedown", { bubbles: true }));
  });
  assert.ok(page.container.querySelector('.day-space-create-popover [role="menuitem"]'));
  await React.act(async () => { choices[1]!.click(); });
  await page.settle();
  const dialog = page.container.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.match(dialog.getAttribute("aria-label") ?? "", /G Todo/);
  const textarea = page.container.querySelector<HTMLTextAreaElement>('.todo-paper-editor textarea');
  assert.ok(textarea);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")?.set?.call(textarea, "Day Space entry");
    textarea.dispatchEvent(new page.container.ownerDocument.defaultView!.Event("input", { bubbles: true }));
  });
  await page.settle();
  const veil = page.container.querySelector<HTMLButtonElement>(".paper-detail-veil");
  assert.ok(veil);
  await React.act(async () => { veil.click(); });
  await page.settle();
  assert.equal(saveRequests.length, 1);
  assert.equal(saveRequests[0]?.path, "/todo/2026-08-12/G");
  assert.equal(saveRequests[0]?.body.revision, null);
  assert.equal(saveRequests[0]?.body.entries[0]?.text, "Day Space entry");
  assert.equal(page.container.querySelector(".day-space-paper-signature")?.textContent, "G");
  assert.match(page.container.textContent ?? "", /Day Space entry/);
  await page.cleanup();
});

test("Day Space create controls reuse an existing author's revision instead of overwriting it", async () => {
  const api: DaySpaceApi = {
    webClient: { request: async () => { throw new Error("Unexpected write"); } },
    listTodoDates: async () => [],
    loadTodoDay: async () => todo,
    listDiaryDates: async () => [],
    loadDiariesByDate: async () => ({ date, diaries: [] }),
    updateDiary: async () => { throw new Error("Unexpected diary write"); },
  };
  const page = await render(api);
  await page.settle();
  const create = page.container.querySelector<HTMLButtonElement>('[aria-label="新增 Todo"]');
  assert.ok(create);
  await React.act(async () => { create.click(); });
  const l = page.container.querySelector<HTMLButtonElement>('.day-space-create-popover [role="menuitem"]');
  assert.ok(l);
  await React.act(async () => { l.click(); });
  await page.settle();
  const dialog = page.container.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.match(dialog.textContent ?? "", /Keep Todo|todo/i);
  const textarea = page.container.querySelector<HTMLTextAreaElement>('.todo-paper-editor textarea');
  assert.ok(textarea);
  assert.equal(textarea.value, "Keep Todo");
  await React.act(async () => { page.container.querySelector<HTMLButtonElement>(".paper-detail-veil")?.click(); });
  await page.settle();
  await page.cleanup();
});
