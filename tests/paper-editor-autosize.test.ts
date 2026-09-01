import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { MemoryPaperEditor } from "../web/src/pages/MemoryPaperEditor.js";
import { DiaryPaperEditor } from "../web/src/pages/DiaryPaperEditor.js";
import { TaskPaperEditor } from "../web/src/pages/TaskPaperEditor.js";

type EditorCase = {
  name: string;
  bodySelector: string;
  render(value: string, onChange: (value: string) => void): React.ReactElement;
};

const EDITORS: readonly EditorCase[] = [
  {
    name: "Memory",
    bodySelector: 'textarea[aria-label="记忆内容"]',
    render: (value, onChange) => React.createElement(MemoryPaperEditor, {
      keyValue: "key",
      content: value,
      disabled: false,
      onKeyChange() {},
      onContentChange: onChange,
    }),
  },
  {
    name: "Diary",
    bodySelector: 'textarea[aria-label="日记正文"]',
    render: (value, onChange) => React.createElement(DiaryPaperEditor, {
      title: "Title",
      content: value,
      disabled: false,
      onTitleChange() {},
      onContentChange: onChange,
    }),
  },
  {
    name: "Task",
    bodySelector: 'textarea[aria-label="任务正文"]',
    render: (value, onChange) => React.createElement(TaskPaperEditor, {
      title: "Title",
      description: value,
      disabled: false,
      onTitleChange() {},
      onDescriptionChange: onChange,
    }),
  },
];

async function withEditorDom(
  editor: EditorCase,
  check: (body: HTMLTextAreaElement, dom: JSDOM, root: ReturnType<typeof createRoot>) => Promise<void>,
) {
  const dom = new JSDOM("<main id=\"root\"></main>", { url: "https://leilei-os.test" });
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
  install("React", React);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  (dom.window.HTMLElement.prototype as unknown as {
    attachEvent(name: string, listener: EventListener): void;
  }).attachEvent = function (name, listener) {
    this.addEventListener(name.replace(/^on/, ""), listener);
  };
  (dom.window.HTMLElement.prototype as unknown as {
    detachEvent(name: string, listener: EventListener): void;
  }).detachEvent = function (name, listener) {
    this.removeEventListener(name.replace(/^on/, ""), listener);
  };

  const stylePrototype = Object.getPrototypeOf(
    dom.window.document.createElement("textarea").style,
  ) as object;
  const heightDescriptor = Object.getOwnPropertyDescriptor(stylePrototype, "height");
  assert.ok(heightDescriptor?.get && heightDescriptor.set);
  Object.defineProperty(stylePrototype, "height", {
    configurable: true,
    enumerable: heightDescriptor.enumerable,
    get: heightDescriptor.get,
    set(value: string) {
      if (value === "auto") {
        dom.window.scrollTo(0, 0);
      }
      heightDescriptor.set!.call(this, value);
    },
  });

  let pageY = 0;
  Object.defineProperty(dom.window, "scrollY", {
    configurable: true,
    get: () => pageY,
  });
  dom.window.scrollTo = (_x, y) => { pageY = Number(y); };

  const node = dom.window.document.querySelector("#root");
  assert.ok(node);
  const root = createRoot(node);
  const initial = "short";

  function Harness() {
    const [value, setValue] = React.useState(initial);
    return editor.render(value, setValue);
  }

  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    const body = node.querySelector<HTMLTextAreaElement>(editor.bodySelector);
    assert.ok(body);
    Object.defineProperty(body, "scrollHeight", {
      configurable: true,
      get: () => body.value.length > initial.length ? 620 : 260,
    });
    pageY = 640;
    body.focus();
    body.setSelectionRange(1, 3);

    await React.act(async () => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(body), "value")?.set?.call(
        body,
        `${initial} with a long line that needs more room`,
      );
      const change = new dom.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(change, "propertyName", { value: "value" });
      body.dispatchEvent(change);
    });

    await check(body, dom, root);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("long paper edits preserve page scroll while all three editors autosize", async () => {
  for (const editor of EDITORS) {
    await withEditorDom(editor, async (body, dom) => {
      assert.equal(dom.window.scrollY, 640, `${editor.name} edit clamped page scroll`);
      assert.equal(body.style.height, "620px", `${editor.name} did not grow to measured content height`);
      assert.equal(body.selectionStart, 1, `${editor.name} edit moved selection start`);
      assert.equal(body.selectionEnd, 3, `${editor.name} edit moved selection end`);
    });
  }
});
