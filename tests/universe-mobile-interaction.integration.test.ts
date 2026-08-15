import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import test from "node:test";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { UniverseMobileMap } from "../web/src/pages/universe/UniverseMobileMap.js";
import type { UniverseGalaxy, UniverseNode, UniverseRelation } from "../web/src/pages/universe/universe-types.js";
import type { UniverseMapMode } from "../web/src/pages/universe/universe-map-interaction.js";

const galaxies: UniverseGalaxy[] = [
  { id: "g1", title: "主星系", description: "", color: "#4c6b57", order: 0 },
];
const nodes: UniverseNode[] = [
  { id: "n1", title: "第一颗星", summary: "", content: "", type: "concept", tags: [], galaxies: [{ id: "g1", weight: 1 }], position: { x: 30, y: 40 }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "n2", title: "第二颗星", summary: "", content: "", type: "concept", tags: [], galaxies: [{ id: "g1", weight: 1 }], position: { x: 70, y: 60 }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
];
const relations: UniverseRelation[] = [
  { id: "r1", source: "n1", target: "n2", relationType: "supports", strength: 0.7, createdAt: "2026-01-01" },
];

function installDom() {
  const dom = new JSDOM("<!doctype html><main id='root'></main>", { url: "https://leilei.test/universe" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Event", "MouseEvent", "React", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "window" ? dom.window : name === "document" ? dom.window.document : name === "navigator" ? dom.window.navigator : name === "HTMLElement" ? dom.window.HTMLElement : name === "Node" ? dom.window.Node : name === "Event" ? dom.window.Event : name === "MouseEvent" ? dom.window.MouseEvent : name === "React" ? React : true,
    });
  }
  return { dom, previous };
}

function restoreDom(dom: JSDOM, previous: Map<string, PropertyDescriptor | undefined>) {
  dom.window.close();
  for (const [name, descriptor] of previous) {
    descriptor ? Object.defineProperty(globalThis, name, descriptor) : Reflect.deleteProperty(globalThis, name);
  }
}

function pointer(target: Element, type: string, x: number, y: number, pointerId = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    clientX: { configurable: true, value: x },
    clientY: { configurable: true, value: y },
  });
  target.dispatchEvent(event);
}

async function mount(mode: UniverseMapMode, callbacks: Record<string, (...args: any[]) => void>) {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const onViewportChange = () => {};
  await React.act(async () => {
    root.render(React.createElement(UniverseMobileMap, {
      galaxies,
      nodes,
      relations,
      selectedNodeId: null,
      activeGalaxyId: null,
      mode,
      initialViewport: { x: 0, y: 0, scale: 1 },
      onViewportChange,
      onSelectNode: callbacks.onSelectNode ?? (() => {}),
      onOpenNode: callbacks.onOpenNode ?? (() => {}),
      onPlaceNode: callbacks.onPlaceNode ?? (() => {}),
      onChooseRelationTarget: callbacks.onChooseRelationTarget ?? (() => {}),
      onMoveNode: callbacks.onMoveNode ?? (async () => {}),
      onModeChange: callbacks.onModeChange ?? (() => {}),
    }));
  });
  const map = context.dom.window.document.querySelector<HTMLElement>(".universe-mobile-map")!;
  Object.defineProperty(map, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, top: 0, width: 390, height: 520, right: 390, bottom: 520 }) });
  const unmount = async () => {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  };
  return { context, map, unmount };
}

test("mounted relation-target mode uses the state machine and exposes a cancellable hint", async () => {
  const calls: Array<{ target: string } | UniverseMapMode> = [];
  const mounted = await mount({ kind: "relation-target", sourceNodeId: "n1" }, {
    onChooseRelationTarget: (target: string) => calls.push({ target }),
    onModeChange: (next: UniverseMapMode) => calls.push(next),
  });
  try {
    assert.match(mounted.map.textContent ?? "", /选择目标星球/);
    assert.ok(mounted.map.querySelector("button[aria-label='取消']"));
    assert.match(mounted.map.querySelector<HTMLElement>(".universe-map-world")?.style.transform ?? "", /scale\(1\)/);
    const target = mounted.map.querySelector<HTMLButtonElement>("button[aria-label='查看节点：第二颗星']")!;
    await React.act(async () => {
      pointer(target, "pointerdown", 260, 260);
      pointer(target, "pointerup", 260, 260);
      target.click();
    });
    assert.deepEqual(calls, [{ kind: "browse" }, { target: "n2" }]);
    assert.equal(mounted.map.querySelector(".universe-map-relation-label")?.textContent, "支持");
  } finally {
    await mounted.unmount();
  }
});

test("a map movement beyond tolerance does not become an empty-space tap", async () => {
  const selected: Array<string | null> = [];
  const mounted = await mount({ kind: "browse" }, { onSelectNode: (id: string | null) => selected.push(id) });
  try {
    await React.act(async () => {
      pointer(mounted.map, "pointerdown", 120, 120);
      pointer(mounted.map, "pointermove", 132, 120);
      pointer(mounted.map, "pointerup", 132, 120);
      mounted.map.click();
    });
    assert.deepEqual(selected, []);
  } finally {
    await mounted.unmount();
  }
});

test("long-press movement saves once and suppresses the follow-up click", async () => {
  const moves: Array<{ id: string; position: { x: number; y: number } }> = [];
  const opened: string[] = [];
  const mounted = await mount({ kind: "browse" }, {
    onMoveNode: (id: string, position: { x: number; y: number }) => moves.push({ id, position }),
    onOpenNode: (id: string) => opened.push(id),
  });
  try {
    const planet = mounted.map.querySelector<HTMLButtonElement>("button[aria-label='查看节点：第一颗星']")!;
    await React.act(async () => { pointer(planet, "pointerdown", 120, 120); });
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    await React.act(async () => {
      pointer(planet, "pointermove", 150, 150);
      pointer(planet, "pointerup", 150, 150);
      planet.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(moves.length, 1);
    assert.equal(moves[0]?.id, "n1");
    assert.deepEqual(opened, []);
  } finally {
    await mounted.unmount();
  }
});

test("placing mode shows a cancellable instruction and opens create only after map placement", async () => {
  const placements: Array<{ x: number; y: number }> = [];
  const mounted = await mount({ kind: "placing-node" }, { onPlaceNode: (position: { x: number; y: number }) => placements.push(position) });
  try {
    assert.match(mounted.map.textContent ?? "", /点一下星图/);
    const cancel = mounted.map.querySelector<HTMLButtonElement>("button[aria-label='取消']")!;
    await React.act(async () => { cancel.click(); });
    assert.deepEqual(placements, []);
  } finally {
    await mounted.unmount();
  }
  const placementMounted = await mount({ kind: "placing-node" }, { onPlaceNode: (position: { x: number; y: number }) => placements.push(position) });
  try {
    await React.act(async () => {
      pointer(placementMounted.map, "pointerdown", 200, 200);
      pointer(placementMounted.map, "pointerup", 200, 200);
      placementMounted.map.click();
    });
    assert.equal(placements.length, 1);
  } finally {
    await placementMounted.unmount();
  }
});
