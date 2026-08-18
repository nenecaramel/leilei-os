import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { useUnsavedChanges } from "../web/src/pages/use-unsaved-changes.js";

function Probe({ dirty }: { dirty: boolean }) {
  useUnsavedChanges(dirty);
  return React.createElement("span", null, dirty ? "dirty" : "clean");
}

test("beforeunload protection exists only while a form is dirty", async () => {
  const dom = new JSDOM("<main id=\"root\"></main>");
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  for (const [name, value] of [
    ["window", dom.window],
    ["document", dom.window.document],
    ["navigator", dom.window.navigator],
    ["HTMLElement", dom.window.HTMLElement],
    ["Node", dom.window.Node],
    ["Event", dom.window.Event],
    ["React", React],
    ["IS_REACT_ACT_ENVIRONMENT", true],
  ] as const) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const container = dom.window.document.querySelector("#root");
  assert.ok(container);
  const root = createRoot(container);

  await React.act(async () => root.render(React.createElement(Probe, { dirty: false })));
  const cleanEvent = new dom.window.Event("beforeunload", { cancelable: true });
  assert.equal(dom.window.dispatchEvent(cleanEvent), true);

  await React.act(async () => root.render(React.createElement(Probe, { dirty: true })));
  const dirtyEvent = new dom.window.Event("beforeunload", { cancelable: true });
  assert.equal(dom.window.dispatchEvent(dirtyEvent), false);

  await React.act(async () => root.render(React.createElement(Probe, { dirty: false })));
  const savedEvent = new dom.window.Event("beforeunload", { cancelable: true });
  assert.equal(dom.window.dispatchEvent(savedEvent), true);

  await React.act(async () => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});
