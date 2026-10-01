import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
import { TodoPaperDialog } from "../web/src/pages/TodoPaperDialog.js";

const requireFromWeb = createRequire(new URL("../web/package.json", import.meta.url));
const React = requireFromWeb("react");
const { act, useState } = React;

test("TodoPaperDialog saves normalized entries with revision and closes once", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/", pretendToBeVisual: true });
  const previous = { window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT };
  const browserGlobals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (callback: FrameRequestCallback) => dom.window.setTimeout(() => callback(dom.window.performance.now()), 0), cancelAnimationFrame: (id: number) => dom.window.clearTimeout(id) };
  dom.window.scrollTo = (() => {}) as typeof dom.window.scrollTo;
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => {} });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => {} });
  for (const [name, value] of Object.entries(browserGlobals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const { createRoot } = requireFromWeb("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  let closed = 0;
  const api = { request: async <T>(path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return { success: true, data: { author: "L", date: "2026-08-12", revision: 5, entries: [{ id: "l-1", kind: "record", text: "changed" }] } } as T;
  } };
  function Harness() {
    const [open, setOpen] = useState(true);
    return React.createElement(TodoPaperDialog, {
      api, author: "L", date: new Date(2026, 7, 12), open,
      paper: { author: "L", date: "2026-08-12", revision: 4, entries: [{ id: "l-1", kind: "record", text: "before" }] },
      triggerRef: { current: null }, onSaved: () => {}, onClosed: () => { closed += 1; setOpen(false); },
    });
  }
  try {
    await act(async () => { root.render(React.createElement(Harness)); });
    const textarea = dom.window.document.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(textarea);
    await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(textarea), "value")!.set!.call(textarea, " changed "); textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true })); });
    const veil = dom.window.document.querySelector<HTMLButtonElement>(".paper-detail-veil");
    assert.ok(veil);
    await act(async () => { veil.click(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.path, "/todo/2026-08-12/L");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { revision: 4, entries: [{ id: "l-1", kind: "record", text: "changed" }] });
    assert.equal(closed, 1);
  } finally {
    await act(async () => { root.unmount(); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    dom.window.close();
    for (const [name, value] of Object.entries(previous)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
});
