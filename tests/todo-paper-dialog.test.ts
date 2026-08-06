import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

const requireFromWeb = createRequire(new URL("../web/package.json", import.meta.url));
const React = requireFromWeb("react");
const { act, useState } = React;
const { createRoot } = requireFromWeb("react-dom/client");
type Root = ReturnType<typeof createRoot>;
import { PaperDetailDialog } from "../web/src/pages/PaperDetailDialog.js";

type DomHarness = {
  dom: JSDOM;
  root: Root;
  container: HTMLElement;
  trigger: HTMLButtonElement;
  cleanup: () => Promise<void>;
};

function installDom(): DomHarness {
  const dom = new JSDOM(
    '<!doctype html><html><body><button id="trigger">Open</button><div id="root"></div></body></html>',
    { url: "http://localhost/" },
  );

  const previousDescriptors = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    Event: dom.window.Event,
    Node: dom.window.Node,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };

  for (const [name, value] of Object.entries(globals)) {
    previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const container = dom.window.document.querySelector<HTMLElement>("#root");
  const trigger = dom.window.document.querySelector<HTMLButtonElement>("#trigger");
  assert.ok(container);
  assert.ok(trigger);

  const root = createRoot(container);

  return {
    dom,
    root,
    container,
    trigger,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      dom.window.close();

      for (const [name, descriptor] of previousDescriptors) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
    },
  };
}

async function renderPaper(
  harness: DomHarness,
  options: {
    open?: boolean;
    onRequestClose?: () => boolean | Promise<boolean>;
  } = {},
): Promise<void> {
  await act(async () => {
    harness.root.render(
      React.createElement(
        PaperDetailDialog,
        {
          id: "paper-test",
          open: options.open ?? true,
          label: "L Todo 2026.08.07",
          dateLabel: "2026.08.07",
          signature: "L",
          triggerRef: { current: harness.trigger },
          onRequestClose: options.onRequestClose ?? (() => true),
        },
        React.createElement("p", null, "Paper body"),
      ),
    );
  });
}

test("Paper detail shell keeps metadata fixed and only the veil requests close", async () => {
  const harness = installDom();

  try {
    let closeCount = 0;
    await renderPaper(harness, {
      onRequestClose: () => {
        closeCount += 1;
        return false;
      },
    });

    const paper = harness.container.querySelector<HTMLElement>(".paper-detail-paper");
    const veil = harness.container.querySelector<HTMLButtonElement>(".paper-detail-veil");
    const scroll = harness.container.querySelector<HTMLElement>(".paper-detail-scroll");
    const date = harness.container.querySelector<HTMLElement>(".paper-detail-date");
    const signature = harness.container.querySelector<HTMLElement>(".paper-detail-signature");

    assert.ok(paper);
    assert.ok(veil);
    assert.ok(scroll);
    assert.ok(date);
    assert.ok(signature);
    assert.equal(paper.getAttribute("role"), "dialog");
    assert.equal(paper.getAttribute("aria-modal"), "true");
    assert.equal(scroll.contains(date), false);
    assert.equal(scroll.contains(signature), false);
    assert.equal(paper.querySelectorAll("button").length, 0);

    await act(async () => {
      paper.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(closeCount, 0);

    await act(async () => {
      veil.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(closeCount, 1);
  } finally {
    await harness.cleanup();
  }
});

test("Escape uses the close request and restores focus after the paper closes", async () => {
  const harness = installDom();

  try {
    let closeCount = 0;

    function ClosingHarness() {
      const [open, setOpen] = useState(true);

      return React.createElement(
        PaperDetailDialog,
        {
          id: "paper-test",
          open,
          label: "L Todo 2026.08.07",
          dateLabel: "2026.08.07",
          signature: "L",
          triggerRef: { current: harness.trigger },
          onRequestClose: () => {
            closeCount += 1;
            setOpen(false);
            return true;
          },
        },
        React.createElement("p", null, "Paper body"),
      );
    }

    harness.trigger.focus();
    await act(async () => {
      harness.root.render(React.createElement(ClosingHarness));
    });

    await act(async () => {
      harness.dom.window.document.dispatchEvent(
        new harness.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    assert.equal(closeCount, 1);
    assert.equal(harness.container.querySelector('[role="dialog"]'), null);
    assert.equal(harness.dom.window.document.activeElement, harness.trigger);
  } finally {
    await harness.cleanup();
  }
});

test("A pending or rejected close cannot re-enter and keeps the paper open", async () => {
  const harness = installDom();

  try {
    let closeCount = 0;
    let resolveClose: ((value: boolean) => void) | undefined;
    const closeResult = new Promise<boolean>((resolve) => {
      resolveClose = resolve;
    });

    await renderPaper(harness, {
      onRequestClose: () => {
        closeCount += 1;
        return closeResult;
      },
    });

    const veil = harness.container.querySelector<HTMLButtonElement>(".paper-detail-veil");
    assert.ok(veil);

    await act(async () => {
      veil.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
      veil.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(closeCount, 1);

    await act(async () => {
      assert.ok(resolveClose);
      resolveClose(false);
      await closeResult;
    });

    assert.ok(harness.container.querySelector('[role="dialog"]'));
  } finally {
    await harness.cleanup();
  }
});
