import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

const bootstrapDom = new JSDOM(
  "<!doctype html><html><body></body></html>",
  { url: "http://localhost/" },
);

for (const [name, value] of Object.entries({
  window: bootstrapDom.window,
  document: bootstrapDom.window.document,
  navigator: bootstrapDom.window.navigator,
})) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

const requireFromWeb = createRequire(new URL("../web/package.json", import.meta.url));
const React = requireFromWeb("react");
const { act, useState } = React;
const { createRoot } = requireFromWeb("react-dom/client");
type Root = ReturnType<typeof createRoot>;
import { PaperDetailDialog } from "../web/src/pages/PaperDetailDialog.js";
import { TodoPaperEditor } from "../web/src/pages/TodoPaperEditor.js";
import { TodoPaperDialog } from "../web/src/pages/TodoPaperDialog.js";

const todoPaperStylesSource = readFileSync(
  new URL("../web/src/styles.css", import.meta.url),
  "utf8",
);

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
    { url: "http://localhost/", pretendToBeVisual: true },
  );

  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value: () => {},
  });

  const previousDescriptors = new Map<string, PropertyDescriptor | undefined>();
  const globals: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      dom.window.setTimeout(
        () => callback(dom.window.performance.now()),
        0,
      ),
    cancelAnimationFrame: (handle: number) =>
      dom.window.clearTimeout(handle),
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

type TodoEditorHandle = {
  getNormalizedEntries(): Array<{
    id: string;
    author: "L" | "G";
    kind: "pending" | "completed" | "record";
    text: string;
  }>;
};

async function renderTodoEditor(
  harness: DomHarness,
  options: {
    author?: "L" | "G";
    initialEntries?: Array<{
      id: string;
      author: "L" | "G";
      kind: "pending" | "completed" | "record";
      text: string;
    }>;
    onDirtyChange?: (dirty: boolean) => void;
  } = {},
) {
  const editorRef: { current: TodoEditorHandle | null } = { current: null };

  await act(async () => {
    harness.root.render(
      React.createElement(TodoPaperEditor, {
        ref: editorRef,
        author: options.author ?? "L",
        initialEntries:
          options.initialEntries ??
          [{ id: "l-1", author: "L", kind: "pending", text: "First" }],
        onDirtyChange: options.onDirtyChange ?? (() => undefined),
      }),
    );
  });

  return editorRef;
}

test("Activating a wrapped Todo immediately expands its textarea", async () => {
  const harness = installDom();

  try {
    Object.defineProperty(
      harness.dom.window.HTMLTextAreaElement.prototype,
      "scrollHeight",
      { configurable: true, get: () => 60 },
    );

    await renderTodoEditor(harness);

    const firstLine = harness.container.querySelector<HTMLButtonElement>(
      '[aria-label="编辑 Todo 第 1 行"]',
    );
    assert.ok(firstLine);

    await act(async () => {
      firstLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const textarea = harness.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Todo 第 1 行"]',
    );
    assert.ok(textarea);
    assert.equal(textarea.style.height, "60px");
  } finally {
    await harness.cleanup();
  }
});


test("Enter moves editing to the next visible Todo line", async () => {
  const harness = installDom();

  try {
    await renderTodoEditor(harness);

    const firstLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 1 行\"]",
      );
    assert.ok(firstLine);

    await act(async () => {
      firstLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const first =
      harness.container.querySelector<HTMLTextAreaElement>(
        "[aria-label=\"Todo 第 1 行\"]",
      );
    assert.ok(first);

    await act(async () => {
      first.dispatchEvent(
        new harness.dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const second =
      harness.container.querySelector<HTMLTextAreaElement>(
        "[aria-label=\"Todo 第 2 行\"]",
      );

    assert.ok(second);
    assert.equal(harness.container.querySelectorAll("textarea").length, 1);
    assert.equal(harness.dom.window.document.activeElement, second);
  } finally {
    await harness.cleanup();
  }
});

test("Backspace on an empty Todo line moves editing to the previous line", async () => {
  const harness = installDom();

  try {
    await renderTodoEditor(harness);

    const secondLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 2 行\"]",
      );
    assert.ok(secondLine);

    await act(async () => {
      secondLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const second =
      harness.container.querySelector<HTMLTextAreaElement>(
        "[aria-label=\"Todo 第 2 行\"]",
      );
    assert.ok(second);
    assert.equal(second.value, "");

    await act(async () => {
      second.dispatchEvent(
        new harness.dom.window.KeyboardEvent("keydown", {
          key: "Backspace",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const first =
      harness.container.querySelector<HTMLTextAreaElement>(
        "[aria-label=\"Todo 第 1 行\"]",
      );

    assert.ok(first);
    assert.equal(harness.container.querySelectorAll("textarea").length, 1);
    assert.equal(harness.dom.window.document.activeElement, first);
  } finally {
    await harness.cleanup();
  }
});

test("Todo status cycles pending completed record pending with accessible labels", async () => {
  const harness = installDom();

  try {
    await renderTodoEditor(harness);

    const status = harness.container.querySelector<HTMLButtonElement>(".todo-paper-status");
    assert.ok(status);

    assert.equal(status.dataset.kind, "pending");
    assert.match(status.getAttribute("aria-label") ?? "", /待办/);

    await act(async () => {
      status.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(status.dataset.kind, "completed");
    assert.match(status.getAttribute("aria-label") ?? "", /已完成/);

    await act(async () => {
      status.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(status.dataset.kind, "record");
    assert.match(status.getAttribute("aria-label") ?? "", /记录/);

    await act(async () => {
      status.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(status.dataset.kind, "pending");
    assert.match(status.getAttribute("aria-label") ?? "", /待办/);
  } finally {
    await harness.cleanup();
  }
});

test("Normalized editor output trims text, drops empty rows, and reports dirty changes", async () => {
  const harness = installDom();

  try {
    const dirtyValues: boolean[] = [];
    const editorRef = await renderTodoEditor(harness, {
      initialEntries: [
        { id: "l-1", author: "L", kind: "record", text: " first " },
        { id: "l-empty", author: "L", kind: "pending", text: "   " },
      ],
      onDirtyChange: (dirty) => dirtyValues.push(dirty),
    });

    const firstLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 1 行\"]",
      );
    assert.ok(firstLine);

    await act(async () => {
      firstLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const first = harness.container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(first);

    await act(async () => {
      first.value = " changed ";
      first.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));
    });

    assert.deepEqual(editorRef.current?.getNormalizedEntries(), [
      { id: "l-1", kind: "record", text: "changed" },
    ]);
    assert.equal(dirtyValues.at(-1), true);
  } finally {
    await harness.cleanup();
  }
});

class TodoDialogStorage implements Storage {
  readonly writes: Array<[string, string]> = [];
  failWrites = false;
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("storage unavailable");
    this.writes.push([key, value]);
    this.values.set(key, value);
  }
}

async function renderTodoPaperDialog(
  harness: ReturnType<typeof installDom>,
  options: {
    storage?: Storage;
    failRequest?: boolean;
    entries?: Array<{
      id: string;
      author: "L" | "G";
      kind: "pending" | "completed" | "record";
      text: string;
    }>;
  } = {},
) {
  const storage = options.storage ?? new TodoDialogStorage();
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const saved: unknown[] = [];
  let closed = 0;
  const triggerRef = { current: harness.dom.window.document.createElement("button") };

  const paperDate = new Date(2026, 7, 7, 12, 0, 0);

  function DialogHarness() {
    const [open, setOpen] = useState(true);
    const [entries, setEntries] = useState(
      options.entries ?? [
        { id: "l-1", author: "L" as const, kind: "pending" as const, text: "First" },
        { id: "l-2", author: "L" as const, kind: "record" as const, text: "Second" },
      ],
    );

    const handleSaved = React.useCallback((nextPaper) => {
      saved.push(nextPaper.entries);
      setEntries(nextPaper.entries.map((entry) => ({ ...entry, author: "L" })));
    }, []);

    const handleClosed = React.useCallback(() => {
      closed += 1;
      setOpen(false);
    }, []);

    return React.createElement(TodoPaperDialog, {
      api: {
        request: async <T>(path: string, init?: RequestInit) => {
          requests.push({ path, init });
          if (options.failRequest) throw new Error("request failed");
          return {
            success: true,
            data: {
              author: "L",
              date: "2026-08-07",
              revision: 1,
              entries: JSON.parse(String(init?.body ?? "{}"))?.entries ?? [],
            },
          } as T;
        },
      },
      author: "L",
      date: paperDate,
      open,
      entries,
      triggerRef,
      storage,
      onSaved: handleSaved,
      onClosed: handleClosed,
    });
  }

  await act(async () => {
    harness.root.render(React.createElement(DialogHarness));
  });

  return {
    storage,
    requests,
    saved,
    get closed() {
      return closed;
    },
  };
}

test("Todo paper coordinator renders L metadata and entries without legacy chrome", async () => {
  const harness = installDom();

  try {
    await renderTodoPaperDialog(harness, {
      entries: [
        { id: "l-1", author: "L", kind: "pending", text: "First" },
        { id: "l-2", author: "L", kind: "completed", text: "Second" },
        { id: "l-3", author: "L", kind: "record", text: "Third" },
      ],
    });

    const dialog = harness.container.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog);
    assert.match(dialog.textContent ?? "", /2026\.08\.07/);
    assert.match(dialog.textContent ?? "", /L/);
    assert.match(dialog.textContent ?? "", /First/);
    assert.match(dialog.textContent ?? "", /Second/);
    assert.match(dialog.textContent ?? "", /Third/);
    assert.doesNotMatch(dialog.textContent ?? "", /今日记录|Today/);
    assert.equal(dialog.querySelector('button[aria-label*="关闭"]'), null);
  } finally {
    await harness.cleanup();
  }
});

test("Todo paper closes without writing when nothing changed", async () => {
  const harness = installDom();

  try {
    const storage = new TodoDialogStorage();
    const rendered = await renderTodoPaperDialog(harness, { storage });

    const veil = harness.container.querySelector<HTMLButtonElement>(".paper-detail-veil");
    assert.ok(veil);

    await act(async () => {
      veil.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });

    assert.equal(storage.writes.length, 0);
    assert.equal(rendered.closed, 1);
    assert.equal(harness.container.querySelector('[role="dialog"]'), null);
  } finally {
    await harness.cleanup();
  }
});

test("Todo paper writes changed entries before closing and reports the saved preview", async () => {
  const harness = installDom();

  try {
    const storage = new TodoDialogStorage();
    const rendered = await renderTodoPaperDialog(harness, { storage });
    const firstLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 1 行\"]",
      );
    assert.ok(firstLine);

    await act(async () => {
      firstLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const first = harness.container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(first);

    await act(async () => {
      first.value = "Changed";
      first.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));
    });

    const veil = harness.container.querySelector<HTMLButtonElement>(".paper-detail-veil");
    assert.ok(veil);

    await act(async () => {
      veil.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });

    assert.equal(rendered.requests.length, 1);
    assert.equal(rendered.requests[0]?.path, "/todo/2026-08-07/L");
    assert.deepEqual(JSON.parse(String(rendered.requests[0]?.init?.body)), {
      revision: null,
      entries: [
        { id: "l-1", kind: "pending", text: "Changed" },
        { id: "l-2", kind: "record", text: "Second" },
      ],
    });
    assert.deepEqual(rendered.saved, [[
      { id: "l-1", kind: "pending", text: "Changed" },
      { id: "l-2", kind: "record", text: "Second" },
    ]]);
    assert.equal(rendered.closed, 1);
    assert.equal(harness.container.querySelector('[role="dialog"]'), null);
  } finally {
    await harness.cleanup();
  }
});

test("Todo paper keeps edits open and shows an alert when storage fails", async () => {
  const harness = installDom();

  try {
    const storage = new TodoDialogStorage();
    storage.failWrites = true;
    const rendered = await renderTodoPaperDialog(harness, { storage, failRequest: true });
    const firstLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 1 行\"]",
      );
    assert.ok(firstLine);

    await act(async () => {
      firstLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const first = harness.container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(first);

    await act(async () => {
      first.value = "Unsaved";
      first.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));
    });

    const veil = harness.container.querySelector<HTMLButtonElement>(".paper-detail-veil");
    assert.ok(veil);

    await act(async () => {
      veil.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true }));
    });

    assert.ok(harness.container.querySelector('[role="dialog"]'));
    assert.match(
      harness.container.querySelector('[role="alert"]')?.textContent ?? "",
      /保存|重试/,
    );
    assert.equal(rendered.closed, 0);
    assert.equal(rendered.saved.length, 0);
    assert.equal(first.value, "Unsaved");
  } finally {
    await harness.cleanup();
  }
});


test("Todo paper CSS defines the fixed ruled paper geometry", () => {
  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-layer\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0[^}]*display:\s*grid[^}]*place-items:\s*center/,
  );
  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-veil\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.82\)/,
  );
  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-paper\s*\{[^}]*width:\s*min\(665px,\s*calc\(100vw - 46px\)\)[^}]*height:\s*clamp\(536px,\s*calc\(78dvh - 24px\),\s*696px\)[^}]*overflow:\s*hidden/,
  );
  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-paper\s*\{[^}]*border:\s*1px solid rgba\(0,\s*0,\s*0,\s*0\.11\)[^}]*border-radius:\s*14px[^}]*background:\s*#ffffff[^}]*box-shadow:\s*0 18px 56px rgba\(0,\s*0,\s*0,\s*0\.09\)/,
  );
  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-scroll\s*\{[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/,
  );
  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-rules span\s*\{[^}]*border-bottom:\s*1px solid rgba\(0,\s*0,\s*0,\s*0\.075\)/,
  );
  assert.match(
    todoPaperStylesSource,
    /@media \(max-height:\s*680px\)[\s\S]*?\.paper-detail-paper\s*\{[^}]*height:\s*calc\(100dvh - 20px\)/,
  );
  assert.doesNotMatch(
    todoPaperStylesSource,
    /\.today-panel-dialog(?:-layer|-backdrop|-header|-content)?\s*\{|\.today-dialog-note\s*\{/,
  );
});


test("Todo paper opens in view mode without focusing a textarea", async () => {
  const harness = installDom();

  try {
    await renderTodoPaperDialog(harness);

    const dialog =
      harness.container.querySelector<HTMLElement>("[role=dialog]");

    assert.ok(dialog);
    assert.equal(harness.container.querySelectorAll("textarea").length, 0);
    assert.equal(
      harness.dom.window.document.activeElement,
      dialog,
    );
    assert.ok(
      harness.container.querySelectorAll(".todo-paper-line-view").length >= 24,
    );
  } finally {
    await harness.cleanup();
  }
});


test("Clicking one Todo line edits only that line", async () => {
  const harness = installDom();

  try {
    await renderTodoPaperDialog(harness);

    const secondLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 2 行\"]",
      );

    assert.ok(secondLine);

    await act(async () => {
      secondLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const textareas =
      harness.container.querySelectorAll<HTMLTextAreaElement>("textarea");

    assert.equal(textareas.length, 1);
    assert.equal(textareas[0].value, "Second");
    assert.equal(
      harness.dom.window.document.activeElement,
      textareas[0],
    );

    assert.ok(
      harness.container.querySelector(
        "[aria-label=\"编辑 Todo 第 1 行\"]",
      ),
    );
  } finally {
    await harness.cleanup();
  }
});


test("Typing in a later Todo row keeps its focus and caret", async () => {
  const harness = installDom();

  try {
    await renderTodoPaperDialog(harness);

    const secondLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 2 行\"]",
      );
    assert.ok(secondLine);

    await act(async () => {
      secondLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const second =
      harness.container.querySelector<HTMLTextAreaElement>(
        "[aria-label=\"Todo 第 2 行\"]",
      );
    assert.ok(second);

    await act(async () => {
      second.focus();
      second.value = "SecXond";
      second.setSelectionRange(4, 4);
      second.dispatchEvent(
        new harness.dom.window.Event("input", { bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    assert.equal(harness.dom.window.document.activeElement, second);
    assert.equal(second.selectionStart, 4);
    assert.equal(second.selectionEnd, 4);
  } finally {
    await harness.cleanup();
  }
});


test("Writing into a blank visible line keeps the paper at 24 lines", async () => {
  const harness = installDom();

  try {
    const editorRef = await renderTodoEditor(harness);

    assert.equal(
      harness.container.querySelectorAll(".todo-paper-row").length,
      24,
    );

    const blankLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 10 行\"]",
      );
    assert.ok(blankLine);

    await act(async () => {
      blankLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const textarea =
      harness.container.querySelector<HTMLTextAreaElement>(
        "[aria-label=\"Todo 第 10 行\"]",
      );
    assert.ok(textarea);
    assert.equal(textarea.value, "");

    await act(async () => {
      textarea.value = "New item";
      textarea.dispatchEvent(
        new harness.dom.window.Event("input", { bubbles: true }),
      );
    });

    assert.equal(
      harness.container.querySelectorAll(".todo-paper-row").length,
      24,
    );

    assert.equal(
      editorRef.current
        ?.getNormalizedEntries()
        .some((entry) => entry.text === "New item"),
      true,
    );
  } finally {
    await harness.cleanup();
  }
});


test("Clicking elsewhere on the paper exits row editing", async () => {
  const harness = installDom();

  try {
    await renderTodoPaperDialog(harness);

    const firstLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 1 行\"]",
      );
    assert.ok(firstLine);

    await act(async () => {
      firstLine.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    assert.ok(harness.container.querySelector("textarea"));

    const paper =
      harness.container.querySelector<HTMLElement>(".paper-detail-paper");
    assert.ok(paper);

    await act(async () => {
      paper.dispatchEvent(
        new harness.dom.window.MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    assert.equal(harness.container.querySelector("textarea"), null);
    assert.ok(
      harness.container.querySelector(
        "[aria-label=\"编辑 Todo 第 1 行\"]",
      ),
    );
  } finally {
    await harness.cleanup();
  }
});


test("Todo paper uses the compact view-edit visual treatment", () => {
  assert.match(todoPaperStylesSource, /\.paper-detail-paper\s*\{[^}]*transform:\s*translateY\(31px\)/s);

  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-paper\s*\{[^}]*width:\s*min\(665px,[^}]*height:\s*clamp\(536px,[^}]*696px\)/s,
  );

  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-date\s*\{[^}]*top:\s*13px[^}]*font-size:\s*13px/s,
  );

  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-signature\s*\{[^}]*bottom:\s*11px[^}]*color:\s*#858585/s,
  );

  assert.match(
    todoPaperStylesSource,
    /\.paper-detail-scroll\s*\{[^}]*inset:\s*42px 0 38px/s,
  );

  assert.match(
    todoPaperStylesSource,
    /\.todo-paper-row textarea:focus\s*\{[^}]*box-shadow:\s*none/s,
  );

  assert.match(
    todoPaperStylesSource,
    /\.todo-paper-line-view\s*\{[^}]*min-height:\s*30px[^}]*border:\s*0[^}]*background:\s*transparent/s,
  );

  assert.match(
    todoPaperStylesSource,
    /\.todo-paper-status\[data-kind="completed"\] \+ textarea,[\s\S]*\.todo-paper-status\[data-kind="completed"\] \+ \.todo-paper-line-view\s*\{[^}]*color:\s*#8f8f8f[^}]*text-decoration:\s*line-through/s,
  );
});


test("Clicking text places the caret at the clicked offset", async () => {
  const harness = installDom();

  try {
    await renderTodoEditor(harness);

    Object.defineProperty(
      harness.dom.window.document,
      "caretPositionFromPoint",
      {
        configurable: true,
        value: () => ({ offset: 2 }),
      },
    );

    const firstLine =
      harness.container.querySelector<HTMLButtonElement>(
        "[aria-label=\"编辑 Todo 第 1 行\"]",
      );
    assert.ok(firstLine);

    await act(async () => {
      firstLine.dispatchEvent(
        new harness.dom.window.MouseEvent("click", {
          bubbles: true,
          clientX: 40,
          clientY: 20,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const textarea =
      harness.container.querySelector<HTMLTextAreaElement>(
        "[aria-label=\"Todo 第 1 行\"]",
      );
    assert.ok(textarea);
    assert.equal(textarea.selectionStart, 2);
    assert.equal(textarea.selectionEnd, 2);
  } finally {
    await harness.cleanup();
  }
});
