import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import test from "node:test";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { UniverseNodePaper } from "../web/src/pages/universe/UniverseNodePaper..js";
import { parseUniverseTags } from "../web/src/pages/universe/UniverseNodeMetadata..js";
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
    await React.act(async () => context.dom.window.document.dispatchEvent(new context.dom.window.MouseEvent("mousedown", { bubbles: true })));
    const g2Trigger = [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "副星系 0.42")!;
    await React.act(async () => { g2Trigger.click(); });
    assert.ok(context.dom.window.document.querySelector("input[aria-label='副星系 权重']"));
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "移出星系")?.click(); });
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

test("metadata keeps raw tag drafts and parses comma variants only at save", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const saves: Array<{ tags: string[] }> = [];
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [{ id: "g1", title: "主星系", description: "", color: "#111", order: 0 }],
        mode: { kind: "edit", nodeId: node.id },
        open: true,
        saving: false,
        triggerRef: { current: null },
        onRequestClose: () => true,
        onSave: async (draft: { tags: string[] }) => { saves.push(draft); },
      }));
    });
    const tags = context.dom.window.document.querySelector<HTMLInputElement>("input[aria-label='标签']")!;
    const setter = Object.getOwnPropertyDescriptor(context.dom.window.HTMLInputElement.prototype, "value")?.set;
    await React.act(async () => {
      setter?.call(tags, "foo,");
      tags.dispatchEvent(new context.dom.window.Event("input", { bubbles: true }));
      setter?.call(tags, "foo, bar");
      tags.dispatchEvent(new context.dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(tags.value, "foo, bar");
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存")?.click(); });
    assert.deepEqual(saves.at(-1)?.tags, ["foo", "bar"]);
    assert.deepEqual(parseUniverseTags("foo，bar"), ["foo", "bar"]);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});

test("type and importance popovers close without changing the current value", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [],
        mode: { kind: "edit", nodeId: node.id },
        open: true,
        saving: false,
        triggerRef: { current: null },
        onRequestClose: () => true,
        onSave: async () => {},
      }));
    });
    const type = [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "experience")!;
    await React.act(async () => type.click());
    assert.ok(context.dom.window.document.querySelector("[aria-label='选择星球类型']"));
    await React.act(async () => context.dom.window.document.dispatchEvent(new context.dom.window.MouseEvent("mousedown", { bubbles: true })));
    assert.equal(context.dom.window.document.querySelector("[aria-label='选择星球类型']"), null);
    assert.equal(type.textContent, "experience");
    const importance = [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "major")!;
    await React.act(async () => importance.click());
    await React.act(async () => context.dom.window.document.dispatchEvent(new context.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(context.dom.window.document.querySelector("[aria-label='选择重要性']"), null);
    assert.equal(importance.textContent, "major");
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});

test("connection overflow requires an explicit remove action and closes on Escape", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const deleted: string[] = [];
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [],
        mode: { kind: "edit", nodeId: node.id },
        open: true,
        saving: false,
        triggerRef: { current: null },
        connections: [{ relation, node: related }],
        onRequestClose: () => true,
        onSave: async () => {},
        onDeleteRelation: (value: UniverseRelation) => deleted.push(value.id),
      }));
    });
    const action = context.dom.window.document.querySelector<HTMLButtonElement>("button[aria-label='连接操作']")!;
    await React.act(async () => action.click());
    assert.deepEqual(deleted, []);
    assert.ok(context.dom.window.document.querySelector("[role='menu'][aria-label='连接操作']"));
    await React.act(async () => context.dom.window.document.dispatchEvent(new context.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.deepEqual(deleted, []);
    await React.act(async () => action.click());
    await React.act(async () => context.dom.window.document.dispatchEvent(new context.dom.window.MouseEvent("mousedown", { bubbles: true })));
    assert.equal(context.dom.window.document.querySelector("[role='menu'][aria-label='连接操作']"), null);
    await React.act(async () => action.click());
    await React.act(async () => [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "移除连接")?.click());
    assert.deepEqual(deleted, ["r1"]);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});

test("Universe metadata is fixed in the paper footer while connections stay in the scroll body", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [{ id: "g1", title: "主星系", description: "", color: "#111", order: 0 }],
        mode: { kind: "detail", nodeId: node.id },
        open: true,
        saving: false,
        triggerRef: { current: null },
        connections: [{ relation, node: related }],
        onRequestClose: () => true,
        onSave: async () => {},
      }));
    });
    assert.ok(context.dom.window.document.querySelector(".paper-detail-bottom-left .universe-node-metadata"));
    assert.equal(context.dom.window.document.querySelector(".paper-detail-body > .universe-node-metadata"), null);
    assert.ok(context.dom.window.document.querySelector(".paper-detail-body .universe-node-connections"));
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});

test("Universe detail renders Diary provenance as an ordered timeline and opens the source", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const opened: string[] = [];
  const sources = [
    { nodeId: "n1", diaryId: "diary-new", title: "较新日记", date: "2026-08-21", status: "active" as const },
    { nodeId: "n1", diaryId: "diary-old", title: "较旧日记", date: "2026-08-01", status: "archived" as const },
  ];
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [],
        mode: { kind: "detail", nodeId: node.id },
        open: true,
        saving: false,
        triggerRef: { current: null },
        sources,
        onOpenDiarySource: (id: string) => opened.push(id),
        onRequestClose: () => true,
        onSave: async () => {},
      }));
    });
    const rows = [...context.dom.window.document.querySelectorAll<HTMLElement>(".universe-node-original-web-mobile .universe-diary-provenance-row")];
    assert.equal(rows.length, 2);
    assert.equal(context.dom.window.document.querySelectorAll(".universe-node-paper-desktop .universe-diary-provenance-row").length, 2);
    assert.match(rows[0]?.textContent ?? "", /2026\.08\.01/);
    assert.match(rows[0]?.textContent ?? "", /较旧日记/);
    assert.match(rows[1]?.textContent ?? "", /2026\.08\.21/);
    await React.act(async () => { (rows[0]?.querySelector("button") as HTMLButtonElement)?.click(); });
    assert.deepEqual(opened, ["diary-old"]);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});

test("Universe detail omits the Diary provenance timeline when no sources exist", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [],
        mode: { kind: "detail", nodeId: node.id },
        open: true,
        saving: false,
        triggerRef: { current: null },
        sources: [],
        onRequestClose: () => true,
        onSave: async () => {},
      }));
    });
    assert.equal(context.dom.window.document.querySelector(".universe-diary-provenance"), null);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});

test("Universe editor keeps source selection draft until picker completion and saves exact Diary IDs", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const saves: unknown[] = [];
  const oldSource = { nodeId: "n1", diaryId: "diary-old", title: "旧日记", date: "2026-08-01", status: "archived" as const };
  const newSource = { nodeId: "n1", diaryId: "diary-new", title: "新日记", date: "2026-08-21", status: "active" as const };
  const sourceOptions = [
    { id: oldSource.diaryId, title: oldSource.title, date: oldSource.date, status: oldSource.status },
    { id: newSource.diaryId, title: newSource.title, date: newSource.date, status: newSource.status },
  ];
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [],
        mode: { kind: "edit", nodeId: node.id },
        open: true,
        saving: false,
        triggerRef: { current: null },
        sources: [oldSource],
        diarySourceOptions: sourceOptions,
        onRequestClose: () => true,
        onSave: async (draft: unknown) => { saves.push(draft); },
      }));
    });
    assert.match(context.dom.window.document.body.textContent ?? "", /2026\.08\.01 · 旧日记 ×/);
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "＋ 添加")?.click(); });
    assert.ok(context.dom.window.document.querySelector("[aria-label='选择来源日记']"));
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("2026.08.21 · 新日记"))?.click(); });
    await React.act(async () => { context.dom.window.document.querySelector<HTMLButtonElement>("[aria-label='取消来源选择']")?.click(); });
    assert.equal(context.dom.window.document.querySelector("[aria-label='选择来源日记']"), null);
    assert.doesNotMatch(context.dom.window.document.body.textContent ?? "", /2026\.08\.21 · 新日记 ×/);
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "＋ 添加")?.click(); });
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("2026.08.21 · 新日记"))?.click(); });
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "完成")?.click(); });
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "保存星球")?.click(); });
    assert.deepEqual((saves.at(-1) as { sourceDiaryIds: string[] }).sourceDiaryIds, ["diary-old", "diary-new"]);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});

test("Universe create editor initializes an explicit empty source set", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node: null,
        galaxies: [],
        mode: { kind: "create", position: { x: 20, y: 30 } },
        open: true,
        saving: false,
        triggerRef: { current: null },
        onRequestClose: () => true,
        onSave: async () => {},
      }));
    });
    assert.ok(context.dom.window.document.querySelector(".universe-standalone-source-field"));
    assert.equal(context.dom.window.document.querySelectorAll(".universe-standalone-source-chip").length, 0);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});

test("Universe source picker keeps searched Diary metadata for the selected chip", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const searched = { id: "diary-search", title: "搜索日记", date: "2026-08-21", status: "active" as const };
  try {
    await React.act(async () => {
      root.render(React.createElement(UniverseNodePaper, {
        node,
        galaxies: [],
        mode: { kind: "edit", nodeId: node.id },
        open: true,
        saving: false,
        triggerRef: { current: null },
        sources: [],
        onRequestClose: () => true,
        onSave: async () => {},
        onSearchDiarySourceOptions: async () => [searched],
      }));
    });
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "＋ 添加")?.click(); await Promise.resolve(); });
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("2026.08.21 · 搜索日记"))?.click(); });
    await React.act(async () => { [...context.dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "完成")?.click(); });
    assert.match(context.dom.window.document.body.textContent ?? "", /2026\.08\.21 · 搜索日记 ×/);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});
