import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { UniversePage, UNIVERSE_IMPORTANCE_OPTIONS, UNIVERSE_NODE_TYPES } from "../web/src/pages/UniversePage.js";

const appSource = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../web/src/pages/UniversePage.tsx", import.meta.url), "utf8");

test("/universe renders the spatial Universe integration instead of a placeholder", () => {
  assert.match(appSource, /import \{ UniversePage \} from "\.\/pages\/UniversePageContainer"/);
  assert.match(appSource, /path="universe"[\s\S]*element=\{<UniversePage \/>\}/);
  assert.doesNotMatch(appSource, /path="universe" element=\{<PlaceholderPage/);
  assert.match(pageSource, /UniverseCanvas/);
  assert.match(pageSource, /LeileiOSUniverseService/);
  assert.match(pageSource, />导出<\/button>/);
});

test("Universe UI keeps the frozen spatial primitives", () => {
  assert.match(pageSource, /className="universe-cosmos"/);
  assert.match(pageSource, /className=.*universe-node/);
  assert.match(pageSource, /className="universe-relation-line"/);
  assert.match(pageSource, /className="universe-node-editor"/);
});

test("Universe editor preserves the standalone node type and importance option sets", () => {
  assert.deepEqual([...UNIVERSE_NODE_TYPES], [
    "concept",
    "question",
    "claim",
    "experience",
    "project",
    "source",
    "reflection",
  ]);
  assert.deepEqual([...UNIVERSE_IMPORTANCE_OPTIONS], ["anchor", "major", "normal"]);
});

test("mounted Universe page loads the server snapshot into the spatial canvas", async () => {
  const dom = new JSDOM("<!doctype html><main id='root'></main>", { url: "https://leilei.test/universe" });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "React", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : name === "document" ? dom.window.document : name === "navigator" ? dom.window.navigator : name === "HTMLElement" ? dom.window.HTMLElement : name === "Node" ? dom.window.Node : name === "Event" ? dom.window.Event : name === "MouseEvent" ? dom.window.MouseEvent : name === "React" ? React : true });
  }
  const root = createRoot(dom.window.document.querySelector("#root")!);
  const node = { id: "node-1", title: "目标", summary: "摘要", content: "正文", type: "concept", tags: [], galaxies: [], position: { x: 50, y: 50 }, createdAt: "2026-08-01", updatedAt: "2026-08-01" };
  const snapshot = { schemaVersion: 2 as const, meta: { name: "我的宇宙", createdAt: "2026-08-01", updatedAt: "2026-08-01" }, galaxies: [], nodes: [node], relations: [], revisions: [] };
  const api = { request: async <T,>(_path: string, _init?: RequestInit) => ({ success: true, data: { snapshot, version: 3 } }) as T };
  try {
    await React.act(async () => {
      root.render(React.createElement(UniversePage, { api }));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    assert.ok(dom.window.document.querySelector(".universe-cosmos"));
    const planet = dom.window.document.querySelector<HTMLButtonElement>(".universe-node");
    assert.equal(planet?.getAttribute("aria-label"), "查看节点：目标");
    await React.act(async () => {
      planet?.click();
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    assert.match(dom.window.document.querySelector(".universe-detail-card")?.textContent ?? "", /目标/);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name);
  }
});

test("mounted Universe editor preserves and edits standalone type and importance", async () => {
  const dom = new JSDOM("<!doctype html><main id='root'></main>", { url: "https://leilei.test/universe" });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "React", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : name === "document" ? dom.window.document : name === "navigator" ? dom.window.navigator : name === "HTMLElement" ? dom.window.HTMLElement : name === "Node" ? dom.window.Node : name === "Event" ? dom.window.Event : name === "MouseEvent" ? dom.window.MouseEvent : name === "React" ? React : true });
  }
  const root = createRoot(dom.window.document.querySelector("#root")!);
  const node = { id: "node-1", title: "经验", summary: "摘要", content: "正文", type: "experience", importance: "major", tags: [], galaxies: [], position: { x: 50, y: 50 }, createdAt: "2026-08-01", updatedAt: "2026-08-01" };
  const snapshot = { schemaVersion: 2 as const, meta: { name: "我的宇宙", createdAt: "2026-08-01", updatedAt: "2026-08-01" }, galaxies: [], nodes: [node], relations: [], revisions: [] };
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api = { request: async <T,>(path: string, init?: RequestInit) => { requests.push({ path, init }); return { success: true, data: { snapshot, version: 3 } } as T; } };
  try {
    await React.act(async () => {
      root.render(React.createElement(UniversePage, { api }));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    await React.act(async () => {
      dom.window.document.querySelector<HTMLButtonElement>(".universe-node")?.click();
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    await React.act(async () => {
      [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === "调整轨道")?.click();
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    const selects = [...dom.window.document.querySelectorAll<HTMLSelectElement>(".universe-node-editor select")];
    assert.equal(selects[0]?.value, "experience");
    assert.equal(selects[1]?.value, "major");
    await React.act(async () => {
      selects[0]!.value = "source";
      selects[0]!.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      selects[1]!.value = "anchor";
      selects[1]!.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    await React.act(async () => {
      [...dom.window.document.querySelectorAll("button")].find((button) => button.textContent === "保存")?.click();
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    const update = requests.find((request) => request.path === "/universe/nodes/node-1");
    const body = JSON.parse(String(update?.init?.body ?? "{}")) as { patch?: { type?: string; importance?: string } };
    assert.equal(body.patch?.type, "source");
    assert.equal(body.patch?.importance, "anchor");
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name);
  }
});
