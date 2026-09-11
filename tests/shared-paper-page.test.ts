import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { WebApiError } from "../web/src/api/web-api-error.js";
import { SharedPaperPageContent } from "../web/src/pages/SharedPaperPage.js";
import { createContiguousRangeEdit, diffText } from "../web/src/pages/shared-paper-diff.js";
import { createSharedPaperApi } from "../web/src/pages/shared-paper-api.js";

type Paper = {
  id: string; userId: string; title: string; content: string; revision: number;
  createdBy: "L" | "G" | "C"; updatedBy: "L" | "G" | "C";
  createdAt: string; updatedAt: string;
};
type Edit = {
  id: string; paperId: string; userId: string; baseRevision: number; revision: number;
  author: "L" | "G" | "C"; startOffset: number; endOffset: number;
  deletedText: string; insertedText: string; createdAt: string;
};

const paper: Paper = {
  id: "paper-1", userId: "user-1", title: "共同纸张", content: "中文 😀 原文",
  revision: 3, createdBy: "L", updatedBy: "C",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z",
};
const edit: Edit = {
  id: "edit-2", paperId: paper.id, userId: paper.userId, baseRevision: 2, revision: 3,
  author: "C", startOffset: 3, endOffset: 4, deletedText: "😀", insertedText: "🌏",
  createdAt: "2026-01-03T00:00:00.000Z",
};

function installDom(path = "/shared-paper") {
  const dom = new JSDOM("<main id='root'></main>", { url: `https://leilei.test${path}`, pretendToBeVisual: true });
  const prior = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const install = (name: PropertyKey, value: unknown) => {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const [name, value] of [["window", dom.window], ["document", dom.window.document], ["navigator", dom.window.navigator], ["Node", dom.window.Node], ["HTMLElement", dom.window.HTMLElement], ["HTMLButtonElement", dom.window.HTMLButtonElement], ["HTMLInputElement", dom.window.HTMLInputElement], ["HTMLTextAreaElement", dom.window.HTMLTextAreaElement], ["Event", dom.window.Event], ["InputEvent", dom.window.InputEvent], ["MouseEvent", dom.window.MouseEvent], ["React", React], ["IS_REACT_ACT_ENVIRONMENT", true] as const]) install(name, value);
  (dom.window.HTMLElement.prototype as unknown as { attachEvent(name: string, listener: EventListener): void }).attachEvent = function (name, listener) { this.addEventListener(name.replace(/^on/, ""), listener); };
  (dom.window.HTMLElement.prototype as unknown as { detachEvent(name: string, listener: EventListener): void }).detachEvent = function (name, listener) { this.removeEventListener(name.replace(/^on/, ""), listener); };
  dom.window.scrollTo = () => {};
  const container = dom.window.document.querySelector("#root")!;
  const root = createRoot(container);
  return { dom, container, root, async cleanup() { await React.act(async () => root.unmount()); dom.window.close(); for (const [name, descriptor] of prior) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name); } };
}

function response<T>(data: T) { return { success: true, data } as T & { success: true; data: T }; }
const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitForCondition(condition: () => boolean) { for (let index = 0; index < 20; index += 1) { if (condition()) return; await waitForPaint(); } assert.fail("Timed out waiting for Shared Paper UI"); }

test("Shared Paper route contract and navigation entry are present", async () => {
  const { NAV_GROUPS } = await import("../web/src/layout/NavigationGroups.js");
  assert.deepEqual(NAV_GROUPS[0]?.entries.map((entry) => entry.label), ["Home", "Memory", "Diary", "Shared Paper", "Task", "Day Space", "Universe", "Sentinel"]);
});

test("Shared Paper list loads, searches in-module, and opens authoritative detail", async () => {
  const calls: string[] = [];
  const env = installDom();
  const api: WebApiClient = { async request<T>(path: string) { calls.push(path); if (path.startsWith("/shared-papers/search")) return response([paper]) as T; if (path === "/shared-papers/paper-1") return response(paper) as T; return response([paper]) as T; } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); await waitForPaint(); });
    assert.match(env.container.textContent ?? "", /Shared Paper/);
    assert.match(env.container.textContent ?? "", /共同纸张/);
    await waitForCondition(() => env.container.querySelector('button[data-paper-id="paper-1"]') !== null);
    const searchButton = env.container.querySelector<HTMLButtonElement>('button[aria-label="搜索 Shared Paper"]');
    assert.ok(searchButton);
    await React.act(async () => searchButton!.click());
    await waitForCondition(() => env.container.querySelector('input[aria-label="搜索 Shared Paper"]') !== null);
    const search = env.container.querySelector<HTMLInputElement>('input[aria-label="搜索 Shared Paper"]');
    assert.ok(search);
    await createSharedPaperApi(api).search("中文");
    assert.ok(calls.some((path) => path.startsWith("/shared-papers/search?query=%E4%B8%AD%E6%96%87")));
    const row = env.container.querySelector<HTMLButtonElement>('button[data-paper-id="paper-1"]');
    assert.ok(row);
    await React.act(async () => row!.click());
    assert.match(env.container.textContent ?? "", /revision 3/);
    assert.match(env.container.textContent ?? "", /中文 😀 原文/);
  } finally { await env.cleanup(); }
});

test("Shared Paper edit diff uses Unicode code-point offsets and no-op saves nothing", () => {
  assert.deepEqual(createContiguousRangeEdit("中文😀", "中文🌏"), { start: 2, end: 3, replacement: "🌏" });
  assert.deepEqual(createContiguousRangeEdit("👩‍💻", "👩‍🚀"), { start: 2, end: 3, replacement: "🚀" });
  assert.equal(createContiguousRangeEdit("same", "same"), null);
  assert.deepEqual(diffText("a😀b", "a🌏b"), { deleted: "😀", inserted: "🌏" });
});

test("Shared Paper edit baseline, history, and revision conflict contract stay explicit", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const env = installDom();
  const latest = { ...paper, revision: 4, content: "server update", updatedBy: "G" as const };
  let detailReads = 0;
  const api: WebApiClient = { async request<T>(path: string, init?: RequestInit) { calls.push({ path, init }); if (path.startsWith("/shared-papers/paper-1/edits")) return response([edit]) as T; if (path === "/shared-papers/paper-1") return response(detailReads++ === 0 ? paper : latest) as T; if (init?.method === "PATCH") throw new WebApiError(409, "PAPER_REVISION_CONFLICT", "conflict"); return response([paper]) as T; } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); await waitForPaint(); });
    const row = env.container.querySelector<HTMLButtonElement>('button[data-paper-id="paper-1"]');
    assert.ok(row);
    await React.act(async () => row!.click());
    const history = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "History");
    assert.ok(history);
    await React.act(async () => history!.click());
    assert.match(env.container.textContent ?? "", /Created/);
    assert.match(env.container.textContent ?? "", /2→3/);
    const editButton = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "Edit");
    assert.ok(editButton);
    await React.act(async () => editButton!.click());
    const editor = env.container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(editor);
    assert.equal(editor.value, paper.content);
    assert.deepEqual(createContiguousRangeEdit(paper.content, "用户草稿"), { start: 0, end: 7, replacement: "用户草稿" });
    await assert.rejects(
      () => createSharedPaperApi(api).edit(paper.id, { expected_revision: paper.revision, author: "C", start: 0, end: 7, replacement: "用户草稿" }),
      (cause: unknown) => cause instanceof WebApiError && cause.status === 409 && cause.code === "PAPER_REVISION_CONFLICT",
    );
    assert.match(env.container.textContent ?? "", /取消|保存/);
  } finally { await env.cleanup(); }
});
