import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { PaperAuthorSignature } from "../web/src/pages/PaperAuthorSignature..js";

async function withDom(
  element: React.ReactElement,
  check: (root: HTMLElement, window: Window) => void | Promise<void>,
) {
  const dom = new JSDOM("<main id=\"root\"></main>", { pretendToBeVisual: true });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    Event: dom.window.Event,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const rootNode = dom.window.document.querySelector<HTMLElement>("#root");
  assert.ok(rootNode);
  const root = createRoot(rootNode);
  try {
    await React.act(async () => root.render(element));
    await check(rootNode, dom.window);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("paper author signature displays L, G, C, and an explicit unknown mark", async () => {
  for (const value of ["L", "G", "C", null] as const) {
    await withDom(
      React.createElement(PaperAuthorSignature, { value, editable: false }),
      (root) => assert.equal(root.textContent, value ?? "—"),
    );
  }
});

test("editable author signature offers exactly L, G, C and closes after selection", async () => {
  const selected: string[] = [];
  await withDom(
    React.createElement(PaperAuthorSignature, {
      value: null,
      editable: true,
      onChange: (value: "L" | "G" | "C") => selected.push(value),
    }),
    async (root) => {
      const trigger = root.querySelector<HTMLButtonElement>("button");
      assert.ok(trigger);
      assert.equal(trigger.textContent, "—");
      await React.act(async () => trigger.click());
      assert.deepEqual(
        [...root.querySelectorAll("[data-author]")].map((node) => node.getAttribute("data-author")),
        ["L", "G", "C"],
      );
      const c = root.querySelector<HTMLButtonElement>('[role="menuitemradio"][data-author="C"]');
      assert.ok(c);
      await React.act(async () => c.click());
      assert.deepEqual(selected, ["C"]);
      assert.equal(root.querySelector('[role="menu"]'), null);
    },
  );
});

test("missing-author validation does not render a persistent paper-chrome prompt", async () => {
  await withDom(
    React.createElement(PaperAuthorSignature, {
      value: null,
      editable: true,
      disabled: false,
      error: "请选择作者",
      onChange() {},
    }),
    async (root) => {
      const trigger = root.querySelector<HTMLButtonElement>("button");
      assert.ok(trigger);
      assert.equal(trigger.textContent, "—");
      assert.equal(root.querySelector('[role="alert"]'), null);
      assert.equal(root.textContent, "—");
    },
  );
});
