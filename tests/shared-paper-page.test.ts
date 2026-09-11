import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
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

async function installDom(path = "/shared-paper") {
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
  const { createRoot } = await import("../web/node_modules/react-dom/client.js");
  const root = createRoot(container);
  return { dom, container, root, async cleanup() { await React.act(async () => root.unmount()); dom.window.close(); for (const [name, descriptor] of prior) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name); } };
}

function response<T>(data: T) { return { success: true, data } as T & { success: true; data: T }; }
const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitForCondition(condition: () => boolean) { for (let index = 0; index < 20; index += 1) { if (condition()) return; await waitForPaint(); } assert.fail("Timed out waiting for Shared Paper UI"); }
function setReactValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value);
  const change = new element.ownerDocument.defaultView!.Event("propertychange", { bubbles: true });
  Object.defineProperty(change, "propertyName", { value: "value" });
  element.dispatchEvent(change);
  element.dispatchEvent(new element.ownerDocument.defaultView!.Event("input", { bubbles: true }));
}

test("Shared Paper route contract and navigation entry are present", async () => {
  const { NAV_GROUPS } = await import("../web/src/layout/NavigationGroups.js");
  assert.deepEqual(NAV_GROUPS[0]?.entries.map((entry) => entry.label), ["Home", "Memory", "Diary", "Shared Paper", "Task", "Day Space", "Universe", "Sentinel"]);
});

test("Shared Paper list loads, searches in-module, and opens authoritative detail", async () => {
  const calls: string[] = [];
  const env = await installDom();
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
  assert.deepEqual(createContiguousRangeEdit("e\u0301", "e"), { start: 1, end: 2, replacement: "" });
  assert.equal(createContiguousRangeEdit("same", "same"), null);
  assert.deepEqual(diffText("a😀b", "a🌏b"), { deleted: "😀", inserted: "🌏" });
  assert.deepEqual(diffText("e\u0301", "e"), { deleted: "\u0301", inserted: "" });
});

test("Shared Paper edit baseline, history, and revision conflict contract stay explicit", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const env = await installDom();
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

test("Shared Paper create cancel confirms dirty draft and clears it before reopen", async () => {
  const env = await installDom();
  const api: WebApiClient = { async request<T>() { return response([paper]) as T; } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); await waitForPaint(); });
    const create = env.container.querySelector<HTMLButtonElement>('button[aria-label="新增 Shared Paper"]');
    assert.ok(create);
    await React.act(async () => create!.click());
    const title = env.container.querySelector<HTMLInputElement>('input[aria-label="Shared Paper 标题"]');
    const content = env.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Shared Paper 正文"]');
    assert.ok(title && content);
    await React.act(async () => { setReactValue(title!, "未保存标题"); setReactValue(content!, "未保存正文"); });
    let confirmations = 0;
    env.dom.window.confirm = () => { confirmations += 1; return true; };
    const cancel = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "取消");
    assert.ok(cancel);
    await React.act(async () => cancel!.click());
    assert.equal(confirmations, 1);
    assert.equal(env.container.querySelector('[role="dialog"]'), null);

    await React.act(async () => create!.click());
    assert.equal(env.container.querySelector<HTMLInputElement>('input[aria-label="Shared Paper 标题"]')?.value, "");
    assert.equal(env.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Shared Paper 正文"]')?.value, "");
  } finally { await env.cleanup(); }
});

test("Shared Paper edit cancel blocks dirty discard and clears baseline after confirmation", async () => {
  const env = await installDom();
  const api: WebApiClient = { async request<T>(path: string) { return path === "/shared-papers/paper-1" ? response(paper) as T : response([paper]) as T; } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); await waitForPaint(); });
    const row = env.container.querySelector<HTMLButtonElement>('button[data-paper-id="paper-1"]');
    assert.ok(row);
    await React.act(async () => row!.click());
    const edit = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "Edit");
    assert.ok(edit);
    await React.act(async () => edit!.click());
    const editor = env.container.querySelector<HTMLTextAreaElement>("textarea[aria-label=\"Shared Paper 正文\"]");
    assert.ok(editor);
    await React.act(async () => setReactValue(editor!, "保留中的草稿"));
    env.dom.window.confirm = () => false;
    let cancel = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "取消");
    assert.ok(cancel);
    await React.act(async () => cancel!.click());
    assert.ok(env.container.querySelector("[role=dialog]"));
    assert.equal(editor!.value, "保留中的草稿");

    env.dom.window.confirm = () => true;
    cancel = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "取消");
    assert.ok(cancel);
    await React.act(async () => cancel!.click());
    assert.ok(env.container.querySelector("[role=dialog]"));
    assert.equal(env.container.querySelector("textarea[aria-label=\"Shared Paper 正文\"]"), null);
    const editAgain = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "Edit");
    assert.ok(editAgain);
    await React.act(async () => editAgain!.click());
    assert.equal(env.container.querySelector<HTMLTextAreaElement>("textarea[aria-label=\"Shared Paper 正文\"]")?.value, paper.content);
  } finally { await env.cleanup(); }
});

test("Shared Paper Save uses the opened revision and real UI interaction for a successful edit", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const env = await installDom();
  const saved = { ...paper, revision: 4, content: "保存后的正文", updatedBy: "L" as const };
  const api: WebApiClient = { async request<T>(path: string, init?: RequestInit) {
    calls.push({ path, init });
    if (init?.method === "PATCH") return response({ paper: saved, edit }) as T;
    if (path === "/shared-papers/paper-1") return response(paper) as T;
    return response([paper]) as T;
  } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); await waitForPaint(); });
    const row = env.container.querySelector<HTMLButtonElement>('button[data-paper-id="paper-1"]');
    assert.ok(row);
    await React.act(async () => row!.click());
    const editButton = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "Edit");
    assert.ok(editButton);
    await React.act(async () => editButton!.click());
    const editor = env.container.querySelector<HTMLTextAreaElement>("textarea[aria-label=\"Shared Paper 正文\"]");
    assert.ok(editor);
    await React.act(async () => setReactValue(editor!, "保存后的正文"));
    const save = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "保存");
    assert.ok(save);
    await React.act(async () => { save!.click(); await waitForPaint(); });
    const patch = calls.find(({ init }) => init?.method === "PATCH");
    assert.ok(patch);
    assert.equal(JSON.parse(String(patch!.init?.body)).expected_revision, 3);
    assert.equal(env.container.querySelector<HTMLTextAreaElement>("textarea[aria-label=\"Shared Paper 正文\"]"), null);
    assert.match(env.container.textContent ?? "", /revision 4/);
  } finally { await env.cleanup(); }
});

test("Shared Paper 409 keeps the draft, blocks stale Save, and resolves by keeping it on the latest revision", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  let patchAttempts = 0;
  const env = await installDom();
  const latest = { ...paper, revision: 4, content: "服务器正文", updatedBy: "G" as const };
  const committed = { ...latest, revision: 5, content: "用户草稿", updatedBy: "C" as const };
  const api: WebApiClient = { async request<T>(path: string, init?: RequestInit) {
    calls.push({ path, init });
    if (init?.method === "PATCH") { patchAttempts += 1; if (patchAttempts === 1) throw new WebApiError(409, "PAPER_REVISION_CONFLICT", "conflict"); return response({ paper: committed, edit }) as T; }
    if (path === "/shared-papers/paper-1") return response(patchAttempts === 0 ? paper : latest) as T;
    return response([paper]) as T;
  } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); await waitForPaint(); });
    const row = env.container.querySelector<HTMLButtonElement>('button[data-paper-id="paper-1"]');
    assert.ok(row);
    await React.act(async () => row!.click());
    const editButton = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "Edit");
    assert.ok(editButton);
    await React.act(async () => editButton!.click());
    const editor = env.container.querySelector<HTMLTextAreaElement>("textarea[aria-label=\"Shared Paper 正文\"]");
    assert.ok(editor);
    await React.act(async () => setReactValue(editor!, "用户草稿"));
    let save = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "保存");
    assert.ok(save);
    await React.act(async () => { save!.click(); await waitForPaint(); await waitForPaint(); });
    await waitForCondition(() => (env.container.textContent ?? "").includes("paper 已被其他编辑更新"));
    assert.equal(editor!.value, "用户草稿");
    assert.match(env.container.textContent ?? "", /revision 4/);
    assert.match(env.container.textContent ?? "", /revision 4 · G/);
    save = [...env.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存");
    assert.ok(save);
    assert.equal(save!.disabled, true);
    await React.act(async () => save!.click());
    assert.equal(patchAttempts, 1);

    const keep = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "继续保留当前草稿");
    assert.ok(keep);
    await React.act(async () => keep!.click());
    assert.equal(editor!.value, "用户草稿");
    save = [...env.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存");
    assert.ok(save && !save!.disabled);
    await React.act(async () => { save!.click(); await waitForPaint(); });
    const patches = calls.filter(({ init }) => init?.method === "PATCH");
    assert.equal(patches.length, 2);
    assert.equal(JSON.parse(String(patches[1]!.init?.body)).expected_revision, 4);
  } finally { await env.cleanup(); }
});

test("Shared Paper conflict load-latest action updates draft and baseline revision before Save", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  let patchAttempts = 0;
  const env = await installDom();
  const latest = { ...paper, revision: 4, content: "最新正文", updatedBy: "G" as const };
  const api: WebApiClient = { async request<T>(path: string, init?: RequestInit) {
    calls.push({ path, init });
    if (init?.method === "PATCH") { patchAttempts += 1; if (patchAttempts === 1) throw new WebApiError(409, "PAPER_REVISION_CONFLICT", "conflict"); return response({ paper: latest, edit }) as T; }
    if (path === "/shared-papers/paper-1") return response(patchAttempts === 0 ? paper : latest) as T;
    return response([paper]) as T;
  } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); await waitForPaint(); });
    const row = env.container.querySelector<HTMLButtonElement>('button[data-paper-id="paper-1"]');
    assert.ok(row);
    await React.act(async () => row!.click());
    const editButton = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "Edit");
    assert.ok(editButton);
    await React.act(async () => editButton!.click());
    const editor = env.container.querySelector<HTMLTextAreaElement>("textarea[aria-label=\"Shared Paper 正文\"]");
    assert.ok(editor);
    await React.act(async () => setReactValue(editor!, "用户草稿"));
    const save = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "保存");
    assert.ok(save);
    await React.act(async () => { save!.click(); await waitForPaint(); await waitForPaint(); });
    await waitForCondition(() => (env.container.textContent ?? "").includes("paper 已被其他编辑更新"));
    const loadLatest = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "载入最新正文");
    assert.ok(loadLatest);
    await React.act(async () => loadLatest!.click());
    assert.equal(editor!.value, "最新正文");
    await React.act(async () => setReactValue(editor!, "最新正文 + 修改"));
    const resolvedSave = [...env.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存");
    assert.ok(resolvedSave && !resolvedSave!.disabled);
    await React.act(async () => { resolvedSave!.click(); await waitForPaint(); });
    const patches = calls.filter(({ init }) => init?.method === "PATCH");
    assert.equal(JSON.parse(String(patches[1]!.init?.body)).expected_revision, 4);
  } finally { await env.cleanup(); }
});

test("Shared Paper history highlights only the changed middle", async () => {
  const env = await installDom();
  const historyEdit = { ...edit, deletedText: "a😀b", insertedText: "a🌏b" };
  const api: WebApiClient = { async request<T>(path: string) { if (path.endsWith("/edits?limit=100")) return response([historyEdit]) as T; if (path === "/shared-papers/paper-1") return response(paper) as T; return response([paper]) as T; } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); await waitForPaint(); });
    const row = env.container.querySelector<HTMLButtonElement>('button[data-paper-id="paper-1"]');
    assert.ok(row);
    await React.act(async () => row!.click());
    const history = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "History");
    assert.ok(history);
    await React.act(async () => history!.click());
    const marks = [...env.container.querySelectorAll("mark")].map((mark) => mark.textContent);
    assert.deepEqual(marks, ["😀", "🌏"]);
    assert.equal(marks.includes("a"), false);
    assert.equal(marks.includes("b"), false);
  } finally { await env.cleanup(); }
});
