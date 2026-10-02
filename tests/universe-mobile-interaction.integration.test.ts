import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import test from "node:test";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { UniverseMobileMap } from "../web/src/pages/universe/UniverseMobileMap.js";
import { UniverseFloatingPopover } from "../web/src/pages/universe/UniverseFloatingPopover.js";
import type { UniverseGalaxy, UniverseNode, UniverseRelation } from "../web/src/pages/universe/universe-types.js";
import type { UniverseMapMode } from "../web/src/pages/universe/universe-map-interaction.js";

const galaxies: UniverseGalaxy[] = [
  { id: "g1", title: "主星系", description: "", color: "#4c6b57", order: 0 },
];
const nodes: UniverseNode[] = [
  { id: "n1", title: "第一颗星", summary: "", content: "", type: "concept", tags: [], galaxies: [{ id: "g1", weight: 1 }], position: { x: 30, y: 40 }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "n2", title: "第二颗星", summary: "", content: "", type: "concept", tags: [], galaxies: [{ id: "g1", weight: 1 }], position: { x: 70, y: 60 }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "n3", title: "普通星", summary: "", content: "", type: "concept", tags: [], galaxies: [{ id: "g1", weight: 1 }], position: { x: 52, y: 82 }, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
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

async function mount(mode: UniverseMapMode, callbacks: Record<string, (...args: any[]) => void>, selectedNodeId: string | null = null, activeGalaxyId: string | null = null, revealNodeId: string | null = null) {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const onViewportChange = () => {};
  await React.act(async () => {
    root.render(React.createElement(UniverseMobileMap, {
      galaxies,
      nodes,
      relations,
      selectedNodeId,
      activeGalaxyId,
      mode,
      initialViewport: { x: 0, y: 0, scale: 1 },
      onViewportChange: callbacks.onViewportChange ?? onViewportChange,
      revealNodeId,
      onSelectNode: callbacks.onSelectNode ?? (() => {}),
      onOpenNode: callbacks.onOpenNode ?? (() => {}),
      onPlaceNode: callbacks.onPlaceNode ?? (() => {}),
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

test("mounted map fades ordinary planets around a selected node without a galaxy filter", async () => {
  const mounted = await mount({ kind: "browse" }, {}, "n1", null);
  try {
    const selected = mounted.map.querySelector<HTMLButtonElement>("button[aria-label='查看节点：第一颗星']")!;
    const neighbor = mounted.map.querySelector<HTMLButtonElement>("button[aria-label='查看节点：第二颗星']")!;
    const ordinary = mounted.map.querySelector<HTMLButtonElement>("button[aria-label='查看节点：普通星']")!;
    assert.equal(selected.classList.contains("is-faded"), false);
    assert.equal(neighbor.classList.contains("is-faded"), false);
    assert.equal(ordinary.classList.contains("is-faded"), true);
    assert.equal(ordinary.style.opacity, "0.28");
  } finally {
    await mounted.unmount();
  }
});

test("related-node reveal keeps zoom and pans only when the target is outside the map", async () => {
  const changes: Array<{ x: number; y: number; scale: number }> = [];
  const mounted = await mount({ kind: "browse" }, { onViewportChange: (viewport: { x: number; y: number; scale: number }) => changes.push(viewport) }, null, null, "n2");
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const revealed = changes.at(-1);
    assert.ok(revealed);
    assert.equal(revealed?.scale, 1);
    assert.ok((revealed?.x ?? 0) < 0 || (revealed?.y ?? 0) < 0);
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
    assert.doesNotMatch(mounted.map.textContent ?? "", /点一下星图/);
    assert.equal(mounted.map.querySelector(".universe-map-mode-hint"), null);
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

function PlacementHarness() {
  const [placementOpen, setPlacementOpen] = React.useState(false);
  const [overflowOpen, setOverflowOpen] = React.useState(false);
  const [galaxyOpen, setGalaxyOpen] = React.useState(false);
  const [mode, setMode] = React.useState<UniverseMapMode>({ kind: "browse" });
  const [created, setCreated] = React.useState(false);
  const addRef = React.useRef<HTMLButtonElement | null>(null);
  const cancelPlacement = () => {
    setMode({ kind: "browse" });
    setPlacementOpen(false);
  };
  return React.createElement(React.Fragment, null,
    React.createElement("button", { ref: addRef, type: "button", "aria-label": "新增星球", "aria-expanded": placementOpen, onClick: () => {
      if (placementOpen || mode.kind === "placing-node") { cancelPlacement(); return; }
      setOverflowOpen(false);
      setGalaxyOpen(false);
      setPlacementOpen(true);
      setMode({ kind: "placing-node" });
    } }, "＋"),
    React.createElement("button", { type: "button", "aria-label": "更多 Universe 操作", "aria-expanded": overflowOpen, onClick: () => { cancelPlacement(); setOverflowOpen(true); } }, "···"),
    React.createElement("button", { type: "button", "aria-label": "选择星系", "aria-expanded": galaxyOpen, onClick: () => { cancelPlacement(); setGalaxyOpen(true); } }, "星系"),
    React.createElement(UniverseFloatingPopover, {
      open: placementOpen,
      anchorRef: addRef,
      ariaLabel: "放置新星球",
      className: "universe-placement-popover",
      shouldIgnoreOutside: (target: EventTarget | null) => Boolean((target as Element | null)?.closest?.(".universe-mobile-map")),
      onRequestClose: cancelPlacement,
      children: React.createElement("span", null, "点击地图选择新星球的位置。"),
    }),
    React.createElement(UniverseMobileMap, {
      galaxies,
      nodes: nodes.slice(0, 1),
      relations: [],
      selectedNodeId: null,
      activeGalaxyId: null,
      mode,
      initialViewport: { x: 0, y: 0, scale: 1 },
      onViewportChange: () => {},
      onSelectNode: () => {},
      onOpenNode: () => {},
      onPlaceNode: () => { setCreated(true); setMode({ kind: "browse" }); setPlacementOpen(false); },
      onMoveNode: async () => {},
      onModeChange: setMode,
    }),
    created ? React.createElement("div", { id: "universe-node-create-paper" }, "create") : null,
  );
}

async function mountPlacementHarness() {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  await React.act(async () => { root.render(React.createElement(PlacementHarness)); });
  const map = context.dom.window.document.querySelector<HTMLElement>(".universe-mobile-map")!;
  Object.defineProperty(map, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, top: 0, width: 390, height: 520, right: 390, bottom: 520 }) });
  return { context, root, map, unmount: async () => { await React.act(async () => root.unmount()); restoreDom(context.dom, context.previous); } };
}

async function assertPlacementCancelledByPageChrome(trigger: string) {
  const mounted = await mountPlacementHarness();
  try {
    const add = mounted.context.dom.window.document.querySelector<HTMLButtonElement>("button[aria-label='新增星球']")!;
    await React.act(async () => add.click());
    assert.equal(add.getAttribute("aria-expanded"), "true");
    if (trigger === "outside") {
      const outside = mounted.context.dom.window.document.createElement("button");
      mounted.context.dom.window.document.body.append(outside);
      await React.act(async () => outside.dispatchEvent(new mounted.context.dom.window.Event("pointerdown", { bubbles: true })));
    } else if (trigger === "plus") {
      await React.act(async () => add.click());
    } else {
      const chrome = mounted.context.dom.window.document.querySelector<HTMLButtonElement>(trigger)!;
      await React.act(async () => chrome.click());
    }
    assert.equal(add.getAttribute("aria-expanded"), "false");
    const map = mounted.map;
    await React.act(async () => {
      pointer(map, "pointerdown", 200, 200);
      pointer(map, "pointerup", 200, 200);
      map.click();
    });
    assert.equal(mounted.context.dom.window.document.querySelector("#universe-node-create-paper"), null);
  } finally {
    await mounted.unmount();
  }
}

test("Universe placement keeps map tap alive and opens exactly one create paper", async () => {
  const mounted = await mountPlacementHarness();
  try {
    const add = mounted.context.dom.window.document.querySelector<HTMLButtonElement>("button[aria-label='新增星球']")!;
    await React.act(async () => add.click());
    assert.equal(mounted.context.dom.window.document.querySelectorAll(".universe-placement-popover").length, 1);
    assert.equal(mounted.map.querySelector(".universe-map-mode-hint"), null);
    await React.act(async () => {
      pointer(mounted.map, "pointerdown", 200, 200);
      pointer(mounted.map, "pointerup", 200, 200);
      mounted.map.click();
    });
    assert.equal(mounted.context.dom.window.document.querySelectorAll("#universe-node-create-paper").length, 1);
  } finally {
    await mounted.unmount();
  }
});

test("Universe placement cancels on non-map outside and on a second plus click", async () => {
  await assertPlacementCancelledByPageChrome("outside");
  await assertPlacementCancelledByPageChrome("plus");
  await assertPlacementCancelledByPageChrome("button[aria-label='更多 Universe 操作']");
  await assertPlacementCancelledByPageChrome("button[aria-label='选择星系']");
});

test("Universe placement remains active through map pointerdown and creates once", async () => {
  const mounted = await mountPlacementHarness();
  try {
    const add = mounted.context.dom.window.document.querySelector<HTMLButtonElement>("button[aria-label='新增星球']")!;
    await React.act(async () => add.click());
    await React.act(async () => {
      pointer(mounted.map, "pointerdown", 200, 200);
      pointer(mounted.map, "pointerup", 200, 200);
      mounted.map.click();
    });
    assert.equal(mounted.context.dom.window.document.querySelectorAll("#universe-node-create-paper").length, 1);
    assert.equal(add.getAttribute("aria-expanded"), "false");
  } finally {
    await mounted.unmount();
  }
});

test("Universe floating popover closes only for outside pointer events and Escape", async () => {
  const context = installDom();
  const root = createRoot(context.dom.window.document.querySelector("#root")!);
  const anchor = context.dom.window.document.createElement("button");
  anchor.textContent = "anchor";
  context.dom.window.document.body.append(anchor);
  let closeCount = 0;
  await React.act(async () => {
    root.render(React.createElement(UniverseFloatingPopover, {
      open: true,
      anchorRef: { current: anchor },
      ariaLabel: "测试菜单",
      onRequestClose: () => { closeCount += 1; },
      children: React.createElement("button", { type: "button" }, "inside"),
    }));
  });
  try {
    const popover = context.dom.window.document.querySelector<HTMLElement>("[role='menu']")!;
    const inside = popover.querySelector("button")!;
    const outside = context.dom.window.document.createElement("button");
    context.dom.window.document.body.append(outside);
    inside.dispatchEvent(new context.dom.window.MouseEvent("mousedown", { bubbles: true }));
    assert.equal(closeCount, 0);
    outside.dispatchEvent(new context.dom.window.MouseEvent("mousedown", { bubbles: true }));
    assert.equal(closeCount, 1);
    outside.dispatchEvent(new context.dom.window.Event("pointerdown", { bubbles: true }));
    assert.equal(closeCount, 1);
    context.dom.window.document.dispatchEvent(new context.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(closeCount, 2);
  } finally {
    await React.act(async () => root.unmount());
    restoreDom(context.dom, context.previous);
  }
});