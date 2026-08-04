import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { GlobalSearchPageContent } from "../web/src/pages/GlobalSearchPage.js";
import {
  createGlobalSearchLocation,
  DEFAULT_GLOBAL_SEARCH_FILTERS,
  getSafeGlobalSearchReturnTo,
  readGlobalSearchFilters,
} from "../web/src/pages/global-search-location.js";
import { getSafeMemoryReturnTo } from "../web/src/pages/memory-location.js";
import { getSafeDiaryReturnTo } from "../web/src/pages/diary-location.js";
import { getSafeTaskReturnTo } from "../web/src/pages/task-location.js";

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

function response(results: unknown[], cursor: string | null = null) {
  return { success: true as const, data: { results, metadata: { count: results.length, has_more: Boolean(cursor), next_cursor: cursor, searched_modules: ["memory", "diary", "task"] as const, searched_scope: "active" } } };
}

function result(id: string) {
  return { entity_type: "memory", entity_id: id, stable_name: "目标", snippet: "命中目标", matched_field: "content", match_reason: "field_match", lifecycle_status: "active", business_time: "2026-08-01T00:00:00.000Z", time_basis: "updated_at", updated_at: "2026-08-01T00:00:00.000Z", detail_tool: "get_memory", detail_arguments: { id, scope: "active" } };
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
