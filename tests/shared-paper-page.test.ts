import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { SharedPaperPageContent } from "../web/src/pages/SharedPaperPage.js";
import { createContiguousRangeEdit, diffText } from "../web/src/pages/shared-paper-diff.js";

type Paper = {
  id: string; user_id: string; title: string; content: string; revision: number;
  created_by: "L" | "G" | "C"; updated_by: "L" | "G" | "C";
  created_at: string; updated_at: string;
};
type Edit = {
  id: string; paper_id: string; user_id: string; base_revision: number; revision: number;
  author: "L" | "G" | "C"; start_offset: number; end_offset: number;
  deleted_text: string; inserted_text: string; created_at: string;
};

const paper: Paper = {
  id: "paper-1", user_id: "user-1", title: "共同纸张", content: "中文 😀 原文",
  revision: 3, created_by: "L", updated_by: "C",
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-03T00:00:00.000Z",
};
const edit: Edit = {
  id: "edit-2", paper_id: paper.id, user_id: paper.user_id, base_revision: 2, revision: 3,
  author: "C", start_offset: 3, end_offset: 4, deleted_text: "😀", inserted_text: "🌏",
  created_at: "2026-01-03T00:00:00.000Z",
};

function installDom(path = "/shared-paper") {
  const dom = new JSDOM("<main id='root'></main>", { url: `https://leilei.test${path}` });
  const prior = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const install = (name: PropertyKey, value: unknown) => {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  for (const [name, value] of [["window", dom.window], ["document", dom.window.document], ["navigator", dom.window.navigator], ["Node", dom.window.Node], ["HTMLElement", dom.window.HTMLElement], ["Event", dom.window.Event], ["MouseEvent", dom.window.MouseEvent], ["React", React], ["IS_REACT_ACT_ENVIRONMENT", true] as const]) install(name, value);
  const container = dom.window.document.querySelector("#root")!;
  const root = createRoot(container);
  return { dom, container, root, cleanup() { root.unmount(); dom.window.close(); for (const [name, descriptor] of prior) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name); } };
}

function response<T>(data: T) { return { success: true, data } as T & { success: true; data: T }; }

test("Shared Paper route contract and navigation entry are present", async () => {
  const { NAV_GROUPS } = await import("../web/src/layout/NavigationGroups.js");
  assert.deepEqual(NAV_GROUPS[0]?.entries.map((entry) => entry.label), ["Home", "Memory", "Diary", "Shared Paper", "Task", "Day Space", "Universe", "Sentinel"]);
});

test("Shared Paper list loads, searches in-module, and opens authoritative detail", async () => {
  const calls: string[] = [];
  const env = installDom();
  const api: WebApiClient = { async request<T>(path: string) { calls.push(path); if (path.startsWith("/shared-papers/search")) return response({ papers: [paper], count: 1 }) as T; if (path === "/shared-papers/paper-1") return response(paper) as T; return response({ papers: [paper], count: 1 }) as T; } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); });
    assert.match(env.container.textContent ?? "", /Shared Paper/);
    assert.match(env.container.textContent ?? "", /共同纸张/);
    const search = env.container.querySelector<HTMLInputElement>('input[aria-label="搜索 Shared Paper"]');
    assert.ok(search);
    await React.act(async () => { search!.value = "中文"; search!.dispatchEvent(new env.dom.window.Event("input", { bubbles: true })); });
    assert.ok(calls.some((path) => path.startsWith("/shared-papers/search?query=%E4%B8%AD%E6%96%87")));
    const row = env.container.querySelector<HTMLButtonElement>('button[data-paper-id="paper-1"]');
    assert.ok(row);
    await React.act(async () => row!.click());
    assert.match(env.container.textContent ?? "", /revision 3/);
    assert.match(env.container.textContent ?? "", /中文 😀 原文/);
  } finally { env.cleanup(); }
});

test("Shared Paper edit diff uses Unicode code-point offsets and no-op saves nothing", () => {
  assert.deepEqual(createContiguousRangeEdit("中文😀", "中文🌏"), { start: 2, end: 3, replacement: "🌏" });
  assert.deepEqual(createContiguousRangeEdit("👩‍💻", "👩‍🚀"), { start: 2, end: 3, replacement: "🚀" });
  assert.equal(createContiguousRangeEdit("same", "same"), null);
  assert.deepEqual(diffText("a😀b", "a🌏b"), { deleted: "😀", inserted: "🌏" });
});

test("Shared Paper create/edit/history and revision conflict keep draft and expose actions", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const env = installDom();
  const latest = { ...paper, revision: 4, content: "server update", updated_by: "G" as const };
  const api: WebApiClient = { async request<T>(path: string, init?: RequestInit) { calls.push({ path, init }); if (path === "/shared-papers/paper-1/edits") return response({ edits: [edit], count: 1 }) as T; if (path === "/shared-papers/paper-1") return response(latest) as T; if (init?.method === "PATCH") throw Object.assign(new Error("conflict"), { status: 409, code: "PAPER_REVISION_CONFLICT" }); return response({ papers: [paper], count: 1 }) as T; } };
  try {
    await React.act(async () => { env.root.render(React.createElement(SharedPaperPageContent, { api })); });
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
    await React.act(async () => { editor!.value = "用户草稿"; editor!.dispatchEvent(new env.dom.window.Event("input", { bubbles: true })); });
    const save = [...env.container.querySelectorAll("button")].find((button) => button.textContent === "Save");
    assert.ok(save);
    await React.act(async () => save!.click());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(env.container.textContent ?? "", /paper 已被其他编辑更新/);
    assert.match(env.container.textContent ?? "", /用户草稿/);
    assert.ok([...env.container.querySelectorAll("button")].some((button) => button.textContent === "载入最新正文"));
    assert.ok(calls.some(({ path, init }) => path === "/shared-papers/paper-1/content" && init?.method === "PATCH"));
  } finally { env.cleanup(); }
});
