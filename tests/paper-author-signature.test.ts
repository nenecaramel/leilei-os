import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { PaperAuthorSignature } from "../web/src/pages/PaperAuthorSignature.js";

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

test("paper author signature displays L, G, and an explicit unknown mark", async () => {
  for (const value of ["L", "G", null] as const) {
    await withDom(
      React.createElement(PaperAuthorSignature, { value, editable: false }),
      (root) => assert.equal(root.textContent, value ?? "—"),
    );
  }
});

test("editable author signature offers exactly L and G and closes after selection", async () => {
  const selected: string[] = [];
  await withDom(
    React.createElement(PaperAuthorSignature, {
      value: null,
      editable: true,
      onChange: (value: "L" | "G") => selected.push(value),
    }),
    async (root) => {
      const trigger = root.querySelector<HTMLButtonElement>("button");
      assert.ok(trigger);
      assert.equal(trigger.textContent, "—");
      await React.act(async () => trigger.click());
      assert.deepEqual(
        [...root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].map((button) => button.textContent),
        ["L", "G"],
      );
      const g = root.querySelector<HTMLButtonElement>('[role="menuitemradio"][data-author="G"]');
      assert.ok(g);
      await React.act(async () => g.click());
      assert.deepEqual(selected, ["G"]);
      assert.equal(root.querySelector('[role="menu"]'), null);
    },
  );
});

test("disabled signature cannot open choices and renders an inline error", async () => {
  await withDom(
    React.createElement(PaperAuthorSignature, {
      value: "L",
      editable: true,
      disabled: true,
      error: "请选择作者",
      onChange() {},
    }),
    async (root) => {
      const trigger = root.querySelector<HTMLButtonElement>("button");
      assert.ok(trigger);
      assert.equal(trigger.disabled, true);
      await React.act(async () => trigger.click());
      assert.equal(root.querySelector('[role="menu"]'), null);
      assert.equal(root.querySelector('[role="alert"]')?.textContent, "请选择作者");
    },
  );
});
