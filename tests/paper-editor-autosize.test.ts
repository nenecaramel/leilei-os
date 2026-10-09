import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { DiaryPaperEditor } from "../web/src/pages/DiaryPaperEditor.js";
import { resizePaperTextarea } from "../web/src/pages/paper-editor-autosize.js";

type EditorCase = {
  name: string;
  bodySelector: string;
  render(value: string, onChange: (value: string) => void): React.ReactElement;
};

const EDITORS: readonly EditorCase[] = [
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
];

async function withEditorDom(
  editor: EditorCase,
  check: (
    body: HTMLTextAreaElement,
    dom: JSDOM,
    root: ReturnType<typeof createRoot>,
  ) => Promise<void>,
) {
  const dom = new JSDOM('<main id="root"></main>', {
    url: "https://leilei-os.test",
  });
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const install = (name: PropertyKey, value: unknown) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
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
  const heightDescriptor = Object.getOwnPropertyDescriptor(
    stylePrototype,
    "height",
  );
  assert.ok(heightDescriptor?.get && heightDescriptor.set);
  const liveStyles = new WeakSet<object>();
  Object.defineProperty(stylePrototype, "height", {
    configurable: true,
    enumerable: heightDescriptor.enumerable,
    get: heightDescriptor.get,
    set(value: string) {
      if (value === "auto" && liveStyles.has(this)) {
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
  let scrollHeightReads = 0;

  function Harness() {
    const [value, setValue] = React.useState(initial);
    return editor.render(value, setValue);
  }

  try {
    await React.act(async () => root.render(React.createElement(Harness)));
    const body = node.querySelector<HTMLTextAreaElement>(editor.bodySelector);
    assert.ok(body);
    liveStyles.add(body.style);
    const textareaPrototype = dom.window.HTMLTextAreaElement.prototype;
    const previousScrollHeight = Object.getOwnPropertyDescriptor(
      textareaPrototype,
      "scrollHeight",
    );
    Object.defineProperty(textareaPrototype, "scrollHeight", {
      configurable: true,
      get: () => {
        scrollHeightReads += 1;
        return body.value.length > initial.length ? 620 : 260;
      },
    });
    pageY = 640;
    scrollHeightReads = 0;
    body.focus();
    body.setSelectionRange(1, 3);

    await React.act(async () => {
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(body),
        "value",
      )?.set?.call(body, `${initial}\nsecond line that grows the editor`);
      const change = new dom.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(change, "propertyName", { value: "value" });
      body.dispatchEvent(change);
    });

    assert.equal(
      scrollHeightReads,
      1,
      `${editor.name} resized more than once for one edit`,
    );
    await check(body, dom, root);
    if (previousScrollHeight)
      Object.defineProperty(
        textareaPrototype,
        "scrollHeight",
        previousScrollHeight,
      );
    else Reflect.deleteProperty(textareaPrototype, "scrollHeight");
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("long paper edits preserve page scroll while all paper editors autosize", async () => {
  for (const editor of EDITORS) {
    await withEditorDom(editor, async (body, dom) => {
      assert.equal(
        dom.window.scrollY,
        640,
        `${editor.name} edit clamped page scroll`,
      );
      assert.equal(
        body.style.height,
        "630px",
        `${editor.name} did not reserve complete paper lines`,
      );
    });
  }
});

test("paper autosize leaves the active text selection untouched", () => {
  const dom = new JSDOM("<textarea></textarea>");
  const body = dom.window.document.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(body);
  Object.defineProperty(body, "scrollHeight", {
    configurable: true,
    value: 620,
  });
  body.value = "keep this selection while measuring";
  body.setSelectionRange(5, 12);

  resizePaperTextarea(body);

  assert.equal(body.selectionStart, 5);
  assert.equal(body.selectionEnd, 12);
  dom.window.close();
});

test("paper autosize follows content growth and shrink without dropping below 240px", () => {
  const dom = new JSDOM("<textarea></textarea>");
  const body = dom.window.document.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(body);
  let measuredHeight = 620;
  const textareaPrototype = dom.window.HTMLTextAreaElement.prototype;
  const previousScrollHeight = Object.getOwnPropertyDescriptor(
    textareaPrototype,
    "scrollHeight",
  );
  Object.defineProperty(textareaPrototype, "scrollHeight", {
    configurable: true,
    get: () => measuredHeight,
  });

  try {
    resizePaperTextarea(body);
    assert.equal(body.style.height, "620px");

    measuredHeight = 180;
    resizePaperTextarea(body);
    assert.equal(body.style.height, "240px");

    measuredHeight = 360;
    resizePaperTextarea(body);
    assert.equal(body.style.height, "360px");
  } finally {
    if (previousScrollHeight)
      Object.defineProperty(
        textareaPrototype,
        "scrollHeight",
        previousScrollHeight,
      );
    else Reflect.deleteProperty(textareaPrototype, "scrollHeight");
  }
  dom.window.close();
});

test("scaled paper rows reserve their visual height on the 30px rule grid", () => {
  const dom = new JSDOM(
    '<div class="paper-textarea-layout"><textarea style="line-height:34.285714px;--paper-editor-scale:0.875"></textarea></div>',
  );
  const body =
    dom.window.document.querySelector<HTMLTextAreaElement>("textarea")!;
  const proto = dom.window.HTMLTextAreaElement.prototype;
  const previous = Object.getOwnPropertyDescriptor(proto, "scrollHeight");
  let measured = 103; // Three 34.285714px lines rounded by scrollHeight.
  Object.defineProperty(proto, "scrollHeight", {
    configurable: true,
    get: () => measured,
  });
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: dom.window,
  });
  try {
    resizePaperTextarea(body, 30);
    assert.equal(body.parentElement!.style.height, "90px");
    assert.ok(Math.abs(parseFloat(body.style.height) * 0.875 - 90) < 0.01);
    measured = 35;
    resizePaperTextarea(body, 30);
    assert.equal(body.parentElement!.style.height, "30px");
    measured = 686;
    resizePaperTextarea(body, 240);
    assert.equal(body.parentElement!.style.height, "600px");
    body.style.setProperty("--paper-editor-scale", "1");
    body.style.lineHeight = "30px";
    measured = 90;
    resizePaperTextarea(body, 30);
    assert.equal(body.parentElement!.style.height, "90px");
    assert.equal(body.style.height, "90px");
  } finally {
    if (previous) Object.defineProperty(proto, "scrollHeight", previous);
    else Reflect.deleteProperty(proto, "scrollHeight");
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
    dom.window.close();
  }
});
