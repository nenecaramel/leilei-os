import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

const requireFromWeb = createRequire(new URL("../web/package.json", import.meta.url));
const React = requireFromWeb("react");
const { createRoot } = requireFromWeb("react-dom/client");
import { PaperDetailDialog } from "../web/src/pages/PaperDetailDialog.js";

const styles = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("Paper detail supports fixed top-right and bottom-left metadata slots", async () => {
  const dom = new JSDOM('<!doctype html><html><body><button id="trigger">Open</button><div id="root"></div></body></html>', {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  const container = dom.window.document.querySelector<HTMLElement>("#root");
  const trigger = dom.window.document.querySelector<HTMLButtonElement>("#trigger");
  assert.ok(container);
  assert.ok(trigger);
  const root = createRoot(container);

  try {
    await React.act(async () => {
      root.render(React.createElement(PaperDetailDialog, {
        id: "paper-slots",
        open: true,
        label: "Memory detail",
        dateLabel: "2026.08.07 22:27",
        signature: "N",
        triggerRef: { current: trigger },
        onRequestClose: () => true,
        topRight: React.createElement("button", { type: "button" }, "编辑"),
        bottomLeft: React.createElement("span", null, "Goal · #focus"),
        children: React.createElement("p", null, "Memory body"),
      }));
    });

    const scroll = container.querySelector<HTMLElement>(".paper-detail-scroll");
    const topRight = container.querySelector<HTMLElement>(".paper-detail-top-right");
    const bottomLeft = container.querySelector<HTMLElement>(".paper-detail-bottom-left");
    assert.ok(scroll);
    assert.ok(topRight);
    assert.ok(bottomLeft);
    assert.equal(scroll.contains(topRight), false);
    assert.equal(scroll.contains(bottomLeft), false);
    assert.equal(topRight.textContent, "编辑");
    assert.equal(bottomLeft.textContent, "Goal · #focus");

    assert.match(styles, /\.paper-detail-top-right\s*\{[^}]*top:\s*13px[^}]*right:\s*24px/s);
    assert.match(styles, /\.paper-detail-bottom-left\s*\{[^}]*left:\s*24px[^}]*bottom:\s*14px/s);
    assert.match(styles, /\.paper-detail-top-right,[\s\S]*\.paper-detail-bottom-left[\s\S]*font-size:\s*13px/s);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
