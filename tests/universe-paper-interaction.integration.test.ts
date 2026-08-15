import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import test from "node:test";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { UniverseNodePaper } from "../web/src/pages/universe/UniverseNodePaper.js";
import type { UniverseNode, UniverseRelation } from "../web/src/pages/universe/universe-types.js";

const node: UniverseNode = {
  id: "n1", title: "原节点", summary: "摘要", content: "正文", type: "experience", importance: "major", tags: ["tag"],
  galaxies: [{ id: "g1", weight: 0.31 }], position: { x: 10, y: 20 }, createdAt: "2026-01-01", updatedAt: "2026-01-02",
};
const related: UniverseNode = { ...node, id: "n2", title: "关联节点", type: "concept" };
const relation: UniverseRelation = { id: "r1", source: "n1", target: "n2", relationType: "supports", strength: 0.8, createdAt: "2026-01-01" };

function installDom() {
  const dom = new JSDOM("<!doctype html><main id='root'></main>");
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "React", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === "window" ? dom.window : name === "document" ? dom.window.document : name === "navigator" ? dom.window.navigator : name === "HTMLElement" ? dom.window.HTMLElement : name === "Node" ? dom.window.Node : name === "Event" ? dom.window.Event : name === "MouseEvent" ? dom.window.MouseEvent : name === "React" ? React : true });
  }
  return { dom, previous };
}

function restoreDom(dom: JSDOM, previous: Map<string, PropertyDescriptor | undefined>) {
  dom.window.close();
  for (const [name, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name);
}

test("mounted node paper preserves weighted memberships and exposes exact type/importance options", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const saves: unknown[] = [];
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [{ id: "g1", title: "主星系", description: "", color: "#111", order: 0 }, { id: "g2", title: "副星系", description: "", color: "#222", order: 1 }],
        mode: { kind: "edit", nodeId: node.id },
        open: true,
        saving: false,
        triggerRef: { current: null },
        onRequestClose: () => true,
        onSave: async (draft: unknown) => { saves.push(draft); },
      }));
    });
    const typeTrigger = [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "experience")!;
    await React.act(async () => { typeTrigger.click(); });
    assert.deepEqual([...context.dom.window.document.querySelectorAll<HTMLButtonElement>(".universe-metadata-popover button")].map((button) => button.textContent), ["concept", "question", "claim", "experience", "project", "source", "reflection"]);
    const importanceTrigger = [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "major")!;
    await React.act(async () => { importanceTrigger.click(); });
    assert.deepEqual([...context.dom.window.document.querySelectorAll<HTMLButtonElement>(".universe-metadata-popover button")].map((button) => button.textContent), ["anchor", "major", "normal"]);
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "＋")?.click(); });
    const galaxyOption = [...context.dom.window.document.querySelectorAll<HTMLButtonElement>(".universe-metadata-popover button")].find((button) => button.textContent === "副星系")!;
    await React.act(async () => galaxyOption.click());
    const weight = context.dom.window.document.querySelector<HTMLInputElement>("input[aria-label='副星系 权重']")!;
    assert.equal(weight.value, "");
    await React.act(async () => {
      const setter = Object.getOwnPropertyDescriptor(context.dom.window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(weight, "0.42");
      weight.dispatchEvent(new context.dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(weight.value, "0.42");
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存")?.click(); });
    assert.equal(saves.length, 1);
    const draft = saves[0] as { galaxies: Array<{ id: string; weight: number }> };
    assert.deepEqual(draft.galaxies, [{ id: "g1", weight: 0.31 }, { id: "g2", weight: 0.42 }]);
    saves.length = 0;
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === "移出")[1]?.click(); });
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存")?.click(); });
    assert.equal(saves.length, 1);
    assert.deepEqual((saves[0] as { galaxies: Array<{ id: string; weight: number }> }).galaxies, [{ id: "g1", weight: 0.31 }]);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});

test("mounted node paper keeps save errors inside the PaperDetailDialog and restores relation actions", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const opened: string[] = [];
  const deleted: string[] = [];
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [],
        mode: { kind: "detail", nodeId: node.id },
        open: true,
        saving: false,
        errorMessage: "保存失败，请稍后重试。",
        triggerRef: { current: null },
        connections: [{ relation, node: related }],
        onRequestClose: () => true,
        onSave: async () => {},
        onOpenRelatedNode: (id: string) => opened.push(id),
        onDeleteRelation: (value: UniverseRelation) => deleted.push(value.id),
      }));
    });
    assert.equal(context.dom.window.document.querySelector(".paper-detail-error")?.textContent, "保存失败，请稍后重试。");
    const relatedButton = [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("关联节点"));
    relatedButton?.click();
    assert.deepEqual(opened, ["n2"]);
    assert.deepEqual(deleted, []);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});
