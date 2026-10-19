import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { GlobalSearchPageContent } from "../web/src/pages/GlobalSearchPage.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import type { GlobalSearchResult } from "../web/src/pages/global-search-result.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function result(id: string, module: GlobalSearchResult["entity_type"] = "mind", snippet = id): GlobalSearchResult {
  return {
    entity_type: module, entity_id: id, stable_name: module === "mind" ? "" : id,
    snippet, matched_field: "text", match_reason: "field_match", lifecycle_status: "active",
    business_time: null, time_basis: "undated", updated_at: "2026-10-19T00:00:00Z",
    detail_tool: module === "mind" ? "get_memory" : "get_diary", detail_arguments: { id },
  };
}
function response(results: GlobalSearchResult[], cursor: string | null = null) {
  return { success: true, data: { results, metadata: { count: results.length, has_more: cursor !== null,
    next_cursor: cursor, searched_modules: ["diary", "todo", "universe", "mind"], searched_scope: "active" } } };
}
async function mount(path = "/search?q=notes") {
  const dom = new JSDOM('<main id="root"></main>', { url: `https://leileios.test${path}` });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const frames: Array<() => void> = [];
  const flushFrames = async () => React.act(async () => { while (frames.length) frames.shift()!(); });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { value: () => {}, configurable: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { value: () => {}, configurable: true });
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    React, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (callback: () => void) => { frames.push(callback); return frames.length; } })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const scroll: number[] = [];
  dom.window.scrollTo = (options: ScrollToOptions) => { scroll.push(options.top ?? 0); };
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const requests: Array<{ path: string; signal?: AbortSignal | null; reply: ReturnType<typeof deferred<unknown>> }> = [];
  const api: WebApiClient = { request<T>(url: string, init?: RequestInit): Promise<T> {
    const reply = deferred<unknown>(); requests.push({ path: url, signal: init?.signal, reply });
    // Deliberately ignore AbortSignal to test the real page's stale-response fence.
    return reply.promise as Promise<T>;
  } };
  const container = dom.window.document.getElementById("root")!;
  let root = createRoot(container);
  const render = () => React.act(async () => { root.render(React.createElement(GlobalSearchPageContent, { api })); });
  await render(); await flushFrames();
  return {
    dom, container, requests, scroll,
    async pop(path: string) { await React.act(async () => {
      dom.window.history.pushState(null, "", path);
      dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
    }); },
    async settle(index: number, value: ReturnType<typeof response> | Error) { await React.act(async () => {
      const pending = requests[index].reply;
      if (value instanceof Error) pending.reject(value); else pending.resolve(value);
      await pending.promise.catch(() => undefined);
    }); },
    button(text: string) {
      const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text);
      assert.ok(button, `button ${text}`); return button;
    },
    async click(button: HTMLButtonElement) { await React.act(async () => button.click()); },
    rows() { return [...container.querySelectorAll<HTMLButtonElement>(".global-search-result-button")]; },
    async remount(path: string, state: unknown) {
      await React.act(async () => root.unmount());
      dom.window.history.replaceState(state, "", path);
      root = createRoot(container); await render(); await flushFrames();
    },
    async cleanup() {
      await React.act(async () => root.unmount()); dom.window.close();
      for (const [name, desc] of previous) {
        if (desc) Object.defineProperty(globalThis, name, desc); else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

for (const outcome of ["success", "failure"] as const) {
  test(`mounted Global Search ignores obsolete ${outcome} after module/date navigation`, async () => {
    const page = await mount();
    try {
      assert.equal(page.requests[0].path, "/search?query=notes", "default includes all four modules without narrowing the API");
      await page.pop("/search?q=new&modules=mind&date_from=2026-10-01&date_to=2026-10-19");
      assert.equal(page.requests[0].signal?.aborted, true);
      assert.equal(page.requests[1].path, "/search?query=new&modules=mind&date_from=2026-10-01&date_to=2026-10-19");
      await page.settle(1, response([result("current", "mind", "Current memory")]));
      await page.settle(0, outcome === "success" ? response([result("obsolete")]) : new Error("private obsolete failure"));
      assert.equal(page.rows().length, 1);
      assert.match(page.rows()[0].textContent ?? "", /Current memory/);
      assert.doesNotMatch(page.container.textContent ?? "", /obsolete|Unable to read search results/);
      assert.equal(page.dom.window.history.state.globalSearch.url, "/search?q=new&modules=mind&date_from=2026-10-01&date_to=2026-10-19");
    } finally { await page.cleanup(); }
  });
}

test("mounted Global Search retries the same cursor, retains rows and merges overlapping mixed-module pages", async () => {
  const page = await mount();
  try {
    await page.settle(0, response([result("same", "mind", "First memory")], "page-2"));
    await page.click(page.button("加载更多"));
    assert.equal(page.requests[1].path, "/search?query=notes&cursor=page-2");
    await page.settle(1, new Error("synthetic page failure"));
    assert.equal(page.rows().length, 1);
    await page.click(page.button("加载更多"));
    assert.equal(page.requests[2].path, page.requests[1].path);
    await page.settle(2, response([result("same", "mind", "Updated memory"), result("same", "diary"), result("new", "mind")]));
    assert.equal(page.rows().length, 3, "same ID across modules is distinct; overlapping Memory appears once");
    assert.match(page.container.textContent ?? "", /Updated memory/);
    assert.doesNotMatch(page.container.textContent ?? "", /First memory/);
    assert.equal(page.container.querySelector(".global-search-load-more"), null);
    assert.equal(page.dom.window.history.state.globalSearch.cursor, null);
    assert.equal(page.dom.window.history.state.globalSearch.results.length, 3);
  } finally { await page.cleanup(); }
});

test("mounted Global Search drops an old pagination response after changing filters", async () => {
  const page = await mount();
  try {
    await page.settle(0, response([result("old")], "page-2"));
    await page.click(page.button("加载更多"));
    await page.pop("/search?q=replacement&modules=mind");
    assert.equal(page.requests[1].signal?.aborted, true);
    await page.settle(2, response([result("replacement")]));
    await page.settle(1, response([result("old-page-2")], "page-3"));
    assert.equal(page.rows().length, 1);
    assert.match(page.rows()[0].textContent ?? "", /replacement/);
    assert.doesNotMatch(page.container.textContent ?? "", /old-page-2/);
    assert.equal(page.dom.window.history.state.globalSearch.cursor, null);
  } finally { await page.cleanup(); }
});

test("mounted Global Search opens undated Memory and restores paginated results, focus and scroll without refetch", async () => {
  const page = await mount();
  try {
    await page.settle(0, response([result("memory-1")], "page-2"));
    await page.click(page.button("加载更多"));
    await page.settle(1, response([result("memory-2")], "page-3"));
    assert.equal(page.rows()[1].querySelector(".global-search-result-date")?.textContent, "", "undated Memory must not invent a date");
    Object.defineProperty(page.dom.window, "scrollY", { configurable: true, value: 420 });
    await page.click(page.rows()[1]);
    assert.equal(page.dom.window.location.pathname, "/mind");
    assert.equal(new URLSearchParams(page.dom.window.location.search).get("memoryId"), "memory-2");
    const saved = page.dom.window.history.state;
    assert.equal(saved.globalSearchReturnTo, "/search?q=notes");
    assert.equal(saved.globalSearch.focusKey, "mind:memory-2");
    const calls = page.requests.length;
    await page.remount("/search?q=notes", saved);
    assert.equal(page.requests.length, calls);
    assert.equal(page.rows().length, 2);
    assert.equal(page.dom.window.document.activeElement, page.rows()[1]);
    assert.equal(page.scroll.at(-1), 420);
    await page.click(page.button("加载更多"));
    assert.equal(page.requests.at(-1)?.path, "/search?query=notes&cursor=page-3");
  } finally { await page.cleanup(); }
});
