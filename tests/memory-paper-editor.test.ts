import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";

test("Memory paper editor exposes controlled title body and bottom metadata", async () => {
  let editorModule: typeof import("../web/src/pages/MemoryPaperEditor.js");
  try {
    editorModule = await import("../web/src/pages/MemoryPaperEditor.js");
  } catch {
    assert.fail("MemoryPaperEditor module is missing");
  }
  const { MemoryPaperEditor, MemoryPaperMetadataEditor } = editorModule;
  const dom = new JSDOM('<div id="root"></div>', { url: "https://leilei-os.test/memory" });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const install = (name: PropertyKey, value: unknown) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  install("window", dom.window);
  install("document", dom.window.document);
  install("navigator", dom.window.navigator);
  install("HTMLElement", dom.window.HTMLElement);
  install("HTMLInputElement", dom.window.HTMLInputElement);
  install("HTMLTextAreaElement", dom.window.HTMLTextAreaElement);
  install("Node", dom.window.Node);
  install("Event", dom.window.Event);
  install("MouseEvent", dom.window.MouseEvent);
  install("React", React);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  (dom.window.HTMLElement.prototype as unknown as { attachEvent(name: string, listener: EventListener): void }).attachEvent = function (name, listener) {
    this.addEventListener(name.replace(/^on/, ""), listener);
  };
  (dom.window.HTMLElement.prototype as unknown as { detachEvent(name: string, listener: EventListener): void }).detachEvent = function (name, listener) {
    this.removeEventListener(name.replace(/^on/, ""), listener);
  };

  const container = dom.window.document.querySelector<HTMLElement>("#root");
  assert.ok(container);
  const root = createRoot(container);
  const ref = React.createRef<{ focusKey(): void }>();
  const changes = { key: "", content: "", category: "", tags: "" };

  try {
    await React.act(async () => {
      root.render(React.createElement(React.Fragment, null,
        React.createElement(MemoryPaperEditor, {
          ref,
          keyValue: "current_goal",
          content: "current body",
          disabled: false,
          onKeyChange: (value: string) => { changes.key = value; },
          onContentChange: (value: string) => { changes.content = value; },
        }),
        React.createElement(MemoryPaperMetadataEditor, {
          category: "goal",
          tagsValue: "MCP, focus",
          disabled: false,
          onCategoryChange: (value: string) => { changes.category = value; },
          onTagsChange: (value: string) => { changes.tags = value; },
        }),
      ));
    });

    const key = container.querySelector<HTMLInputElement>('input[aria-label="记忆 Key"]');
    const body = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="记忆内容"]');
    const category = container.querySelector<HTMLButtonElement>('button[aria-label="记忆分类"]');
    const tags = container.querySelector<HTMLInputElement>('input[aria-label="记忆标签"]');
    assert.ok(key && body && category && tags);
    assert.equal(container.querySelector("select"), null);
    assert.equal(key.tagName, "INPUT");

    const setValue = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value);
      const change = new dom.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(change, "propertyName", { value: "value" });
      element.dispatchEvent(change);
    };
    await React.act(async () => {
      key.focus();
      setValue(key, "renamed_key");
      body.focus();
      setValue(body, "new body");
      tags.focus();
      setValue(tags, "alpha, beta");
      category.click();
    });
    const project = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
      .find((button) => button.textContent === "Project");
    assert.ok(project);
    await React.act(async () => { project.click(); });

    assert.equal(changes.key, "renamed_key");
    assert.equal(changes.content, "new body");
    assert.equal(changes.tags, "alpha, beta");
    assert.equal(changes.category, "project");
    ref.current?.focusKey();
    assert.equal(dom.window.document.activeElement, key);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
