import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import routerDom from "../web/node_modules/react-router-dom/dist/index.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { GlobalSearchPageContent } from "../web/src/pages/GlobalSearchPage.js";
import {
  createGlobalSearchLocation,
  DEFAULT_GLOBAL_SEARCH_FILTERS,
  getSafeGlobalSearchReturnTo,
  hasSearchableGlobalSearchQuery,
  isGlobalSearchQueryWithinLimit,
  readGlobalSearchFilters,
  toggleGlobalSearchModule,
  type SearchModule,
} from "../web/src/pages/global-search-location.js";
import { getSafeMemoryReturnTo } from "../web/src/pages/memory-location.js";
import { getSafeDiaryReturnTo } from "../web/src/pages/diary-location.js";
import { getSafeTaskReturnTo } from "../web/src/pages/task-location.js";
import { navigateWithinApp } from "../web/src/pages/app-navigation.js";

const { BrowserRouter, Route, Routes } = routerDom;

test("global search URL parsing uses safe defaults and stable serialization", () => {
  const parsed = readGlobalSearchFilters("?q=%E2%98%95&modules=task,memory,task&scope=bad&mode=bad&date_from=2026-02-30");
  assert.deepEqual(parsed, { q: "☕", modules: ["memory", "task"], scope: "active", mode: "normal", dateFrom: "", dateTo: "" });
  assert.equal(createGlobalSearchLocation(DEFAULT_GLOBAL_SEARCH_FILTERS), "/search");
  assert.equal(createGlobalSearchLocation({ ...DEFAULT_GLOBAL_SEARCH_FILTERS, q: "  e\u0301 ", modules: ["task"], scope: "archived", mode: "phrase", dateFrom: "2026-01-01" }), "/search?q=%C3%A9&modules=task&scope=archived&mode=phrase&date_from=2026-01-01");
  assert.equal(getSafeGlobalSearchReturnTo("https://evil.test/search?q=x"), "/search");
  assert.equal(getSafeGlobalSearchReturnTo("/search?q=x&scope=active"), "/search?q=x");
  assert.equal(getSafeGlobalSearchReturnTo("/memory?memory=secret"), "/search");
  assert.equal(getSafeMemoryReturnTo("/search?q=goal&scope=archived"), "/search?q=goal&scope=archived");
  assert.equal(getSafeDiaryReturnTo("/search?q=goal&modules=diary"), "/search?q=goal&modules=diary");
  assert.equal(getSafeTaskReturnTo("/search?q=goal&mode=phrase"), "/search?q=goal&mode=phrase");
});

test("global search distinguishes an empty query from an overlong query", () => {
  assert.equal(isGlobalSearchQueryWithinLimit(""), true);
  assert.equal(isGlobalSearchQueryWithinLimit("  \u0065\u0301  "), true);
  assert.equal(hasSearchableGlobalSearchQuery(""), false);
  assert.equal(hasSearchableGlobalSearchQuery("  \u0065\u0301  "), true);
  assert.equal(isGlobalSearchQueryWithinLimit("a".repeat(200)), true);
  assert.equal(isGlobalSearchQueryWithinLimit("a".repeat(201)), false);
  assert.equal(hasSearchableGlobalSearchQuery("a".repeat(200)), true);
  assert.equal(hasSearchableGlobalSearchQuery("a".repeat(201)), false);
  assert.equal(getSafeGlobalSearchReturnTo(`/search?q=${"a".repeat(201)}`), "/search");
  assert.equal(getSafeGlobalSearchReturnTo(`/search?q=${"a".repeat(200)}`), `/search?q=${"a".repeat(200)}`);
});

test("global search never removes the final selected module", () => {
  const onlyMemory = { ...DEFAULT_GLOBAL_SEARCH_FILTERS, modules: ["memory" as const] };
  assert.deepEqual(toggleGlobalSearchModule(onlyMemory, "memory"), onlyMemory);
  assert.equal(createGlobalSearchLocation(toggleGlobalSearchModule(onlyMemory, "memory")), "/search?modules=memory");
  assert.deepEqual(
    toggleGlobalSearchModule({ ...onlyMemory, modules: ["memory", "task"] }, "memory").modules,
    ["task"],
  );
});

test("in-app navigation notifies the router after changing location", () => {
  const dom = new JSDOM("<main></main>", { url: "https://leilei.test/memory" });
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousPopStateEvent = Object.getOwnPropertyDescriptor(globalThis, "PopStateEvent");
  Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: dom.window });
  Object.defineProperty(globalThis, "PopStateEvent", { configurable: true, writable: true, value: dom.window.PopStateEvent });
  try {
    let notifications = 0;
    dom.window.addEventListener("popstate", () => { notifications += 1; });
    navigateWithinApp("/search?q=goal");
    assert.equal(`${dom.window.location.pathname}${dom.window.location.search}`, "/search?q=goal");
    assert.equal(notifications, 1);
  } finally {
    previousWindow ? Object.defineProperty(globalThis, "window", previousWindow) : Reflect.deleteProperty(globalThis, "window");
    previousPopStateEvent ? Object.defineProperty(globalThis, "PopStateEvent", previousPopStateEvent) : Reflect.deleteProperty(globalThis, "PopStateEvent");
    dom.window.close();
  }
});

test("in-app navigation changes the rendered BrowserRouter route", async () => {
  const dom = new JSDOM("<main id='root'></main>", { url: "https://leilei.test/memory" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "PopStateEvent", "React", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : name === "document" ? dom.window.document : name === "navigator" ? dom.window.navigator : name === "HTMLElement" ? dom.window.HTMLElement : name === "Node" ? dom.window.Node : name === "Event" ? dom.window.Event : name === "PopStateEvent" ? dom.window.PopStateEvent : name === "React" ? React : true });
  }
  const root = createRoot(dom.window.document.querySelector("#root")!);
  try {
    await React.act(async () => {
      root.render(React.createElement(BrowserRouter, null, React.createElement(Routes, null,
        React.createElement(Route, { path: "/memory", element: React.createElement("p", null, "Memory route") }),
        React.createElement(Route, { path: "/search", element: React.createElement("p", null, "Search route") }),
      )));
    });
    assert.match(dom.window.document.body.textContent ?? "", /Memory route/);
    await React.act(async () => { navigateWithinApp("/search?q=goal"); });
    assert.match(dom.window.document.body.textContent ?? "", /Search route/);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name);
  }
});

function response(results: unknown[], cursor: string | null = null) {
  return { success: true as const, data: { results, metadata: { count: results.length, has_more: Boolean(cursor), next_cursor: cursor, searched_modules: ["memory", "diary", "task"] as const, searched_scope: "active" } } };
}

function result(id: string) {
  return { entity_type: "memory", entity_id: id, stable_name: "目标", snippet: "命中目标", matched_field: "content", match_reason: "field_match", lifecycle_status: "active", business_time: "2026-08-01T00:00:00.000Z", time_basis: "updated_at", updated_at: "2026-08-01T00:00:00.000Z", detail_tool: "get_memory", detail_arguments: { id, scope: "active" } };
}

async function renderSearch(path: string, api: WebApiClient) {
  const dom = new JSDOM("<main id='root'></main>", { url: `https://leilei.test${path}` });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "InputEvent", "PopStateEvent", "React", "IS_REACT_ACT_ENVIRONMENT", "requestAnimationFrame"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : name === "document" ? dom.window.document : name === "navigator" ? dom.window.navigator : name === "HTMLElement" ? dom.window.HTMLElement : name === "HTMLInputElement" ? dom.window.HTMLInputElement : name === "Node" ? dom.window.Node : name === "Event" ? dom.window.Event : name === "MouseEvent" ? dom.window.MouseEvent : name === "InputEvent" ? dom.window.InputEvent : name === "PopStateEvent" ? dom.window.PopStateEvent : name === "React" ? React : name === "requestAnimationFrame" ? ((callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(Date.now()), 0)) : true });
  }
  dom.window.scrollTo = () => {};
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await React.act(async () => {
    root.render(React.createElement(GlobalSearchPageContent, { api }));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  });
  return {
    dom,
    root,
    async settle() {
      await React.act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 0)); });
    },
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name);
    },
  };
}

function reactChange(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  const props = Object.values(input).find((candidate): candidate is { onChange?: (event: { target: { value: string } }) => void } =>
    typeof candidate === "object" && candidate !== null && "onChange" in candidate,
  );
  assert.equal(typeof props?.onChange, "function");
  props.onChange?.({ target: { value } });
}

test("global search page does not request empty q, passes filters, paginates, and renders result fields", async () => {
  const requests: string[] = [];
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => { resolve = r; });
  const api: WebApiClient = { request<T>(path: string): Promise<T> { requests.push(path); return pending as Promise<T>; } };
  const dom = new JSDOM("<main id='root'></main>", { url: "https://leilei.test/search?q=%E7%9B%AE%E6%A0%87&modules=task" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "InputEvent", "PopStateEvent", "React", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : name === "document" ? dom.window.document : name === "navigator" ? dom.window.navigator : name === "HTMLElement" ? dom.window.HTMLElement : name === "HTMLInputElement" ? dom.window.HTMLInputElement : name === "Node" ? dom.window.Node : name === "Event" ? dom.window.Event : name === "MouseEvent" ? dom.window.MouseEvent : name === "InputEvent" ? dom.window.InputEvent : name === "PopStateEvent" ? dom.window.PopStateEvent : name === "React" ? React : true });
  }
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await React.act(async () => root.render(React.createElement(GlobalSearchPageContent, { api })));
  assert.equal(requests.length, 1);
  assert.match(requests[0]!, /\/search\?query=%E7%9B%AE%E6%A0%87/);
  assert.match(requests[0]!, /modules=task/);
  resolve(response([result("00000000-0000-4000-8000-000000000001")], "cursor"));
  await React.act(async () => { await pending; });
  assert.match(dom.window.document.body.textContent ?? "", /目标/);
  assert.match(dom.window.document.body.textContent ?? "", /正文/);
  await React.act(async () => root.unmount()); dom.window.close();
  for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name);
});

test("global search restores its URL-bound snapshot after detail navigation", async () => {
  const requests: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      requests.push(path);
      return response([result("00000000-0000-4000-8000-000000000002")], "next-page") as T;
    },
  };
  const dom = new JSDOM("<main id='root'></main>", { url: "https://leilei.test/search?q=goal&modules=memory" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "MouseEvent", "InputEvent", "PopStateEvent", "React", "IS_REACT_ACT_ENVIRONMENT", "requestAnimationFrame"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : name === "document" ? dom.window.document : name === "navigator" ? dom.window.navigator : name === "HTMLElement" ? dom.window.HTMLElement : name === "HTMLInputElement" ? dom.window.HTMLInputElement : name === "Node" ? dom.window.Node : name === "Event" ? dom.window.Event : name === "MouseEvent" ? dom.window.MouseEvent : name === "InputEvent" ? dom.window.InputEvent : name === "PopStateEvent" ? dom.window.PopStateEvent : name === "React" ? React : name === "requestAnimationFrame" ? ((callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(Date.now()), 0)) : true });
  }
  const scrolls: number[] = [];
  dom.window.scrollTo = (options?: ScrollToOptions | number) => { if (typeof options === "object") scrolls.push(options.top ?? 0); };
  const root = createRoot(dom.window.document.querySelector("#root")!);
  try {
    await React.act(async () => {
      root.render(React.createElement(GlobalSearchPageContent, { api }));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    const detail = [...dom.window.document.querySelectorAll("button")]
      .find((button) => button.textContent === "查看详情");
    assert.ok(detail);
    dom.window.scrollY = 180;
    await React.act(async () => {
      detail.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.match(`${dom.window.location.pathname}${dom.window.location.search}`, /^\/memory\?memory=/);
    assert.equal(dom.window.history.state.globalSearch.url, "/search?q=goal&modules=memory");
    assert.equal(dom.window.history.state.globalSearch.cursor, "next-page");

    await React.act(async () => {
      dom.window.history.pushState(dom.window.history.state, "", "/search?q=goal&modules=memory");
      dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 5));
    });
    assert.equal(requests.length, 1);
    assert.match(dom.window.document.body.textContent ?? "", /目标/);
    assert.ok(scrolls.includes(180));
    assert.equal(dom.window.document.activeElement?.textContent, "查看详情");
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name);
  }
});

test("global search opens active and archived detail routes for every module", async () => {
  const cases: Array<{ module: SearchModule; archived: boolean }> = [
    { module: "memory", archived: false }, { module: "memory", archived: true },
    { module: "diary", archived: false }, { module: "diary", archived: true },
    { module: "task", archived: false }, { module: "task", archived: true },
  ];
  for (const { module, archived } of cases) {
    const entityId = `item-${module}-${archived ? "archived" : "active"}`;
    const api: WebApiClient = { async request<T>() { return response([{ ...result(entityId), entity_type: module, lifecycle_status: archived ? "archived" : "active" }]) as T; } };
    const page = await renderSearch(`/search?q=goal&modules=${module}`, api);
    try {
      const button = [...page.dom.window.document.querySelectorAll("button")]
        .find((candidate) => candidate.textContent === "查看详情");
      assert.ok(button);
      await React.act(async () => { button.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true })); });
      const location = new URL(page.dom.window.location.href);
      assert.equal(location.pathname, `/${module}`);
      assert.equal(location.searchParams.get("returnTo"), `/search?q=goal&modules=${module}`);
      if (module === "memory") assert.equal(location.searchParams.get(archived ? "archivedMemory" : "memory"), entityId);
      if (module === "diary") assert.equal(location.searchParams.get(archived ? "archivedDiary" : "diary"), entityId);
      if (module === "task") {
        assert.equal(location.searchParams.get("task"), entityId);
        assert.equal(location.searchParams.get("archived"), archived ? "1" : null);
      }
    } finally {
      await page.cleanup();
    }
  }
});

test("global search blocks an invalid date range and preserves paged results for retry", async () => {
  const requests: string[] = [];
  let loadMoreAttempt = 0;
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      requests.push(path);
      if (path.includes("cursor=next-page")) {
        loadMoreAttempt += 1;
        if (loadMoreAttempt === 1) throw new Error("temporary");
        return response([
          result("00000000-0000-4000-8000-000000000003"),
          result("00000000-0000-4000-8000-000000000004"),
        ]) as T;
      }
      return response([result("00000000-0000-4000-8000-000000000003")], "next-page") as T;
    },
  };
  const page = await renderSearch("/search?q=goal", api);
  try {
    assert.equal(requests.length, 1);
    const from = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-from");
    const to = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-to");
    assert.ok(from); assert.ok(to);
    await React.act(async () => { reactChange(from, "2026-08-10"); });
    await page.settle();
    assert.match(`${page.dom.window.location.pathname}${page.dom.window.location.search}`, /date_from=2026-08-10/);
    const requestsAfterValidFrom = requests.length;
    const invalidTo = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-to");
    assert.ok(invalidTo);
    await React.act(async () => { reactChange(invalidTo, "2026-08-09"); });
    assert.equal(requests.length, requestsAfterValidFrom);
    assert.match(page.dom.window.document.body.textContent ?? "", /开始日期不能晚于结束日期。/);
    assert.match(`${page.dom.window.location.pathname}${page.dom.window.location.search}`, /date_from=2026-08-10/);
    assert.doesNotMatch(`${page.dom.window.location.pathname}${page.dom.window.location.search}`, /date_to=2026-08-09/);
    const correctedTo = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-to");
    assert.ok(correctedTo);
    await React.act(async () => { reactChange(correctedTo, "2026-08-11"); });
    await page.settle();
    assert.equal(page.dom.window.document.querySelector("[role=alert]"), null);
    assert.match(requests.at(-1) ?? "", /date_from=2026-08-10/);
    assert.match(requests.at(-1) ?? "", /date_to=2026-08-11/);

    const loadMore = [...page.dom.window.document.querySelectorAll("button")]
      .find((button) => button.textContent === "加载更多");
    assert.ok(loadMore);
    await React.act(async () => { loadMore.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true })); });
    await page.settle();
    assert.match(page.dom.window.document.body.textContent ?? "", /加载更多失败，请重试。/);
    assert.equal(page.dom.window.document.querySelectorAll(".memory-card").length, 1);
    const retry = [...page.dom.window.document.querySelectorAll("button")]
      .find((button) => button.textContent === "加载更多");
    assert.ok(retry);
    await React.act(async () => { retry.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true })); });
    await page.settle();
    assert.equal(page.dom.window.document.querySelectorAll(".memory-card").length, 2);
    assert.equal(loadMoreAttempt, 2);
  } finally {
    await page.cleanup();
  }
});

test("global search debounces input, aborts stale reads, and never renders stale results", async () => {
  let resolveOld!: (value: unknown) => void;
  let resolveNew!: (value: unknown) => void;
  const oldResponse = new Promise<unknown>((resolve) => { resolveOld = resolve; });
  const newResponse = new Promise<unknown>((resolve) => { resolveNew = resolve; });
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      return (path.includes("query=old") ? oldResponse : newResponse) as Promise<T>;
    },
  };
  const page = await renderSearch("/search", api);
  try {
    assert.equal(requests.length, 0, "empty q never requests");
    const firstInput = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-query");
    assert.ok(firstInput);
    await React.act(async () => { reactChange(firstInput, "old"); });
    await React.act(async () => { await new Promise((resolve) => page.dom.window.setTimeout(resolve, 250)); });
    assert.equal(requests.length, 0, "debounce has not elapsed");
    await React.act(async () => { await new Promise((resolve) => page.dom.window.setTimeout(resolve, 80)); });
    assert.equal(requests.length, 1);
    const staleSignal = requests[0]?.init?.signal;
    const secondInput = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-query");
    assert.ok(secondInput);
    await React.act(async () => { reactChange(secondInput, "new"); });
    await React.act(async () => { await new Promise((resolve) => page.dom.window.setTimeout(resolve, 310)); });
    assert.equal(requests.length, 2);
    assert.equal(staleSignal?.aborted, true);
    await React.act(async () => { resolveNew(response([{ ...result("00000000-0000-4000-8000-000000000005"), stable_name: "新结果" }])); await new Promise((resolve) => page.dom.window.setTimeout(resolve, 0)); });
    await React.act(async () => { resolveOld(response([{ ...result("00000000-0000-4000-8000-000000000006"), stable_name: "旧结果" }])); await new Promise((resolve) => page.dom.window.setTimeout(resolve, 0)); });
    assert.match(page.dom.window.document.body.textContent ?? "", /新结果/);
    assert.doesNotMatch(page.dom.window.document.body.textContent ?? "", /旧结果/);
    assert.equal(page.dom.window.document.querySelectorAll(".memory-card").length, 1);
    assert.match(requests[1]?.path ?? "", /query=new/);
  } finally {
    await page.cleanup();
  }
});

test("clearing a query returns to idle without requesting or restoring the old snapshot", async () => {
  const requests: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      requests.push(path);
      return response([result("00000000-0000-4000-8000-000000000011")], "next-cursor") as T;
    },
  };
  const page = await renderSearch("/search?q=base", api);
  try {
    await page.settle();
    assert.match(page.dom.window.document.body.textContent ?? "", /目标/);
    assert.ok(page.dom.window.history.state?.globalSearch);
    const input = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-query");
    assert.ok(input);
    await React.act(async () => { reactChange(input, ""); });
    await React.act(async () => { await new Promise((resolve) => page.dom.window.setTimeout(resolve, 310)); });
    assert.equal(requests.length, 1);
    assert.equal(`${page.dom.window.location.pathname}${page.dom.window.location.search}`, "/search");
    assert.equal(page.dom.window.history.state?.globalSearch, undefined);
    assert.doesNotMatch(page.dom.window.document.body.textContent ?? "", /目标/);
    assert.match(page.dom.window.document.body.textContent ?? "", /输入关键词后开始搜索/);
    assert.doesNotMatch(page.dom.window.document.body.textContent ?? "", /搜索关键词不能超过 200 个字符/);
    assert.equal(page.dom.window.document.querySelector("[role=alert]"), null);
  } finally {
    await page.cleanup();
  }
});

test("clearing an overlong initial URL normalizes the address without requesting", async () => {
  const requests: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      requests.push(path);
      return response([]) as T;
    },
  };
  const page = await renderSearch(`/search?q=${"x".repeat(201)}&modules=memory&scope=all&mode=phrase&date_from=2026-08-01`, api);
  try {
    assert.equal(requests.length, 0);
    assert.match(page.dom.window.document.body.textContent ?? "", /搜索关键词不能超过 200 个字符/);
    const input = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-query");
    assert.ok(input);
    await React.act(async () => { reactChange(input, ""); });
    await React.act(async () => { await new Promise((resolve) => page.dom.window.setTimeout(resolve, 310)); });
    assert.equal(requests.length, 0);
    assert.equal(`${page.dom.window.location.pathname}${page.dom.window.location.search}`, "/search?modules=memory&scope=all&mode=phrase&date_from=2026-08-01");
    assert.equal(page.dom.window.history.state?.globalSearch, undefined);
    assert.doesNotMatch(page.dom.window.document.body.textContent ?? "", /搜索关键词不能超过 200 个字符/);
    assert.match(page.dom.window.document.body.textContent ?? "", /输入关键词后开始搜索/);
  } finally {
    await page.cleanup();
  }
});

test("empty query filter changes update URL without requesting", async () => {
  const requests: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      requests.push(path);
      return response([]) as T;
    },
  };
  const page = await renderSearch("/search", api);
  try {
    const module = page.dom.window.document.querySelector<HTMLInputElement>("input[type=checkbox]");
    assert.ok(module);
    await React.act(async () => { reactChange(module, ""); });
    const scope = page.dom.window.document.querySelector<HTMLSelectElement>("#global-search-scope");
    assert.ok(scope);
    await React.act(async () => { reactChange(scope, "all"); });
    const mode = page.dom.window.document.querySelector<HTMLSelectElement>("#global-search-mode");
    assert.ok(mode);
    await React.act(async () => { reactChange(mode, "phrase"); });
    const from = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-from");
    assert.ok(from);
    await React.act(async () => { reactChange(from, "2026-08-01"); });
    assert.equal(requests.length, 0);
    assert.equal(`${page.dom.window.location.pathname}${page.dom.window.location.search}`, "/search?modules=diary%2Ctask&scope=all&mode=phrase&date_from=2026-08-01");
    assert.match(page.dom.window.document.body.textContent ?? "", /输入关键词后开始搜索/);
    assert.doesNotMatch(page.dom.window.document.body.textContent ?? "", /搜索关键词不能超过 200 个字符/);
  } finally {
    await page.cleanup();
  }
});

test("popstate snapshot restoration invalidates a pending newer request", async () => {
  let resolveB!: (value: unknown) => void;
  const pendingB = new Promise<unknown>((resolve) => { resolveB = resolve; });
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      return pendingB as Promise<T>;
    },
  };
  const page = await renderSearch("/search?q=b", api);
  const resultA = { ...result("00000000-0000-4000-8000-000000000007"), stable_name: "查询 A" };
  const snapshotA = { version: 1, url: "/search?q=a", results: [resultA], cursor: "a-cursor", scrollY: 240, focusKey: "memory:00000000-0000-4000-8000-000000000007" };
  try {
    assert.equal(requests.length, 1);
    await React.act(async () => {
      page.dom.window.history.pushState({ globalSearch: snapshotA }, "", "/search?q=a");
      page.dom.window.dispatchEvent(new page.dom.window.PopStateEvent("popstate"));
      await new Promise((resolve) => page.dom.window.setTimeout(resolve, 0));
    });
    assert.equal(requests[0]?.init?.signal?.aborted, true);
    assert.match(page.dom.window.document.body.textContent ?? "", /查询 A/);
    resolveB(response([{ ...result("00000000-0000-4000-8000-000000000008"), stable_name: "查询 B" }], "b-cursor"));
    await React.act(async () => { await pendingB; await new Promise((resolve) => page.dom.window.setTimeout(resolve, 0)); });
    assert.match(`${page.dom.window.location.pathname}${page.dom.window.location.search}`, /^\/search\?q=a$/);
    assert.match(page.dom.window.document.body.textContent ?? "", /查询 A/);
    assert.doesNotMatch(page.dom.window.document.body.textContent ?? "", /查询 B/);
    assert.deepEqual(page.dom.window.history.state.globalSearch, snapshotA);
  } finally {
    await page.cleanup();
  }
});

test("invalid date drafts do not let other filter changes alter the applied search", async () => {
  const requests: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      requests.push(path);
      return response([result("00000000-0000-4000-8000-000000000009")]) as T;
    },
  };
  const page = await renderSearch("/search?q=base", api);
  try {
    await page.settle();
    const from = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-from");
    assert.ok(from);
    await React.act(async () => { reactChange(from, "2026-08-10"); });
    await page.settle();
    const validUrl = `${page.dom.window.location.pathname}${page.dom.window.location.search}`;
    const requestsAfterFrom = requests.length;
    const to = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-to");
    assert.ok(to);
    await React.act(async () => { reactChange(to, "2026-08-09"); });
    assert.match(page.dom.window.document.body.textContent ?? "", /开始日期不能晚于结束日期。/);
    const invalidUrl = `${page.dom.window.location.pathname}${page.dom.window.location.search}`;
    assert.equal(invalidUrl, validUrl);
    const query = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-query");
    assert.ok(query);
    await React.act(async () => { reactChange(query, "changed"); });
    await React.act(async () => { await new Promise((resolve) => page.dom.window.setTimeout(resolve, 310)); });
    const module = page.dom.window.document.querySelector<HTMLInputElement>("input[type=checkbox]");
    assert.ok(module);
    await React.act(async () => { reactChange(module, ""); });
    const scope = page.dom.window.document.querySelector<HTMLSelectElement>("#global-search-scope");
    assert.ok(scope);
    await React.act(async () => { reactChange(scope, "all"); });
    const mode = page.dom.window.document.querySelector<HTMLSelectElement>("#global-search-mode");
    assert.ok(mode);
    await React.act(async () => { reactChange(mode, "phrase"); });
    assert.equal(requests.length, requestsAfterFrom);
    assert.equal(`${page.dom.window.location.pathname}${page.dom.window.location.search}`, validUrl);

    const correctedTo = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-to");
    assert.ok(correctedTo);
    await React.act(async () => { reactChange(correctedTo, "2026-08-11"); });
    await page.settle();
    assert.equal(requests.length, requestsAfterFrom + 1);
    assert.match(requests.at(-1) ?? "", /query=changed/);
    assert.match(requests.at(-1) ?? "", /date_from=2026-08-10/);
    assert.match(requests.at(-1) ?? "", /date_to=2026-08-11/);
    assert.match(requests.at(-1) ?? "", /scope=all/);
    assert.match(requests.at(-1) ?? "", /mode=phrase/);
    assert.doesNotMatch(page.dom.window.document.body.textContent ?? "", /开始日期不能晚于结束日期。/);
  } finally {
    await page.cleanup();
  }
});

test("invalid date drafts never enter a detail return target", async () => {
  const api: WebApiClient = {
    async request<T>(): Promise<T> {
      return response([result("00000000-0000-4000-8000-000000000010")]) as T;
    },
  };
  const page = await renderSearch("/search?q=base", api);
  try {
    await page.settle();
    const from = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-from");
    const to = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-to");
    assert.ok(from); assert.ok(to);
    await React.act(async () => { reactChange(from, "2026-08-10"); });
    await page.settle();
    const invalidTo = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-date-to");
    assert.ok(invalidTo);
    await React.act(async () => { reactChange(invalidTo, "2026-08-09"); });
    const button = [...page.dom.window.document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "查看详情");
    assert.ok(button);
    await React.act(async () => { button.dispatchEvent(new page.dom.window.MouseEvent("click", { bubbles: true })); });
    const detailUrl = new URL(page.dom.window.location.href);
    assert.equal(detailUrl.searchParams.get("returnTo"), "/search?q=base&date_from=2026-08-10");
  } finally {
    await page.cleanup();
  }
});

test("global search enforces a 200-code-point query limit without truncating", async () => {
  const requests: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      requests.push(path);
      return response([]) as T;
    },
  };
  const page = await renderSearch(`/search?q=${encodeURIComponent("😀".repeat(201))}`, api);
  try {
    assert.equal(requests.length, 0);
    assert.match(page.dom.window.document.body.textContent ?? "", /搜索关键词不能超过 200 个字符。/);
    const input = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-query");
    assert.ok(input);
    await React.act(async () => { reactChange(input, "😀".repeat(100)); });
    await React.act(async () => { await new Promise((resolve) => page.dom.window.setTimeout(resolve, 310)); });
    assert.equal(requests.length, 1);
    assert.match(requests[0] ?? "", /query=/);
    assert.equal([...decodeURIComponent(new URL(`https://leilei.test${requests[0]}`).searchParams.get("query") ?? "")].length, 100);
  } finally {
    await page.cleanup();
  }
});

test("global search accepts exactly 200 code points and rejects 201", async () => {
  const requests: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      requests.push(path);
      return response([]) as T;
    },
  };
  const page = await renderSearch(`/search?q=${"a".repeat(200)}`, api);
  try {
    assert.equal(requests.length, 1);
    const input = page.dom.window.document.querySelector<HTMLInputElement>("#global-search-query");
    assert.ok(input);
    await React.act(async () => { reactChange(input, "b".repeat(201)); });
    await React.act(async () => { await new Promise((resolve) => page.dom.window.setTimeout(resolve, 310)); });
    assert.equal(requests.length, 1);
    assert.match(page.dom.window.document.body.textContent ?? "", /搜索关键词不能超过 200 个字符。/);
  } finally {
    await page.cleanup();
  }
});

test("popstate to an overlong query clears old results without requesting", async () => {
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      return response([result("00000000-0000-4000-8000-000000000012")], "old-cursor") as T;
    },
  };
  const page = await renderSearch("/search?q=base", api);
  try {
    await page.settle();
    assert.match(page.dom.window.document.body.textContent ?? "", /目标/);
    await React.act(async () => {
      page.dom.window.history.pushState(null, "", `/search?q=${"x".repeat(201)}`);
      page.dom.window.dispatchEvent(new page.dom.window.PopStateEvent("popstate"));
      await new Promise((resolve) => page.dom.window.setTimeout(resolve, 0));
    });
    assert.equal(requests.length, 1);
    assert.doesNotMatch(page.dom.window.document.body.textContent ?? "", /目标/);
    assert.match(page.dom.window.document.body.textContent ?? "", /搜索关键词不能超过 200 个字符/);
    assert.equal([...page.dom.window.document.querySelectorAll("button")].some((button) => button.textContent === "加载更多"), false);
  } finally {
    await page.cleanup();
  }
});
