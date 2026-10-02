import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { PaperAuthorSignature } from "../web/src/pages/PaperAuthorSignature..js";
import { PaperDetailDialog } from "../web/src/pages/PaperDetailDialog..js";

async function withDom(
  element: React.ReactElement,
  check: (root: HTMLElement) => void | Promise<void>,
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
    await check(rootNode);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("paper metadata stays bottom-left while author reuses the original signature slot", async () => {
  const triggerRef = React.createRef<HTMLElement>();

  await withDom(
    React.createElement(
      PaperDetailDialog,
      {
        id: "paper-layout-test",
        open: true,
        label: "paper layout test",
        dateLabel: "2026.08.11",
        signature: "",
        triggerRef,
        onRequestClose: () => true,
        bottomLeft: React.createElement(
          React.Fragment,
          null,
          React.createElement("span", { "data-testid": "metadata" }, "Project · #tag"),
          React.createElement(PaperAuthorSignature, {
            value: null,
            editable: false,
          }),
        ),
      },
      React.createElement("p", null, "body"),
    ),
    (root) => {
      const bottomLeft = root.querySelector<HTMLElement>(".paper-detail-bottom-left");
      const signatureSlot = root.querySelector<HTMLElement>(".paper-detail-signature");
      const portalSlot = root.querySelector<HTMLElement>(".paper-detail-signature-portal");
      assert.ok(bottomLeft);
      assert.ok(signatureSlot);
      assert.ok(portalSlot);
      assert.equal(bottomLeft.textContent, "Project · #tag");
      assert.equal(bottomLeft.querySelector(".paper-author-signature"), null);
      assert.equal(signatureSlot.textContent, "—");
      assert.ok(portalSlot.querySelector(".paper-author-signature"));
      assert.equal(portalSlot.childNodes.length, 1);
    },
  );
});
