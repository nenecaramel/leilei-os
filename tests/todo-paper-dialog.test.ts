import assert from "node:assert/strict";
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
  focusFirstRow(): void;
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

test("Todo editor keeps one creation row and Enter creates and focuses the next row", async () => {
  const harness = installDom();

  try {
    await renderTodoEditor(harness);

    let textareas = [...harness.container.querySelectorAll<HTMLTextAreaElement>("textarea")];
    assert.equal(textareas.length, 2);

    await act(async () => {
      textareas[0].dispatchEvent(
        new harness.dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    textareas = [...harness.container.querySelectorAll<HTMLTextAreaElement>("textarea")];
    assert.equal(textareas.length, 3);
    assert.equal(harness.dom.window.document.activeElement, textareas[1]);
  } finally {
    await harness.cleanup();
  }
});

test("Backspace removes an empty non-final row and focuses the previous row", async () => {
  const harness = installDom();

  try {
    await renderTodoEditor(harness);

    let textareas = [...harness.container.querySelectorAll<HTMLTextAreaElement>("textarea")];

    await act(async () => {
      textareas[0].dispatchEvent(
        new harness.dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    textareas = [...harness.container.querySelectorAll<HTMLTextAreaElement>("textarea")];
    assert.equal(textareas.length, 3);

    await act(async () => {
      textareas[1].dispatchEvent(
        new harness.dom.window.KeyboardEvent("keydown", {
          key: "Backspace",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    textareas = [...harness.container.querySelectorAll<HTMLTextAreaElement>("textarea")];
    assert.equal(textareas.length, 2);
    assert.equal(harness.dom.window.document.activeElement, textareas[0]);
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

    const first = harness.container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(first);

    await act(async () => {
      first.value = " changed ";
      first.dispatchEvent(new harness.dom.window.Event("input", { bubbles: true }));
    });

    assert.deepEqual(editorRef.current?.getNormalizedEntries(), [
      { id: "l-1", author: "L", kind: "record", text: "changed" },
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
    entries?: Array<{
      id: string;
      author: "L" | "G";
      kind: "pending" | "completed" | "record";
      text: string;
    }>;
  } = {},
) {
  const storage = options.storage ?? new TodoDialogStorage();
  const saved: unknown[] = [];
  let closed = 0;
  const triggerRef = { current: harness.dom.window.document.createElement("button") };

  function DialogHarness() {
    const [open, setOpen] = useState(true);
    const [entries, setEntries] = useState(
      options.entries ?? [
        { id: "l-1", author: "L" as const, kind: "pending" as const, text: "First" },
        { id: "l-2", author: "L" as const, kind: "record" as const, text: "Second" },
      ],
    );

    return React.createElement(TodoPaperDialog, {
      author: "L",
      date: new Date(2026, 7, 7, 12, 0, 0),
      open,
      entries,
      triggerRef,
      storage,
      onSaved: (nextEntries) => {
        saved.push(nextEntries);
        setEntries(nextEntries);
      },
      onClosed: () => {
        closed += 1;
        setOpen(false);
      },
    });
  }

  await act(async () => {
    harness.root.render(React.createElement(DialogHarness));
  });

  return {
    storage,
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

    assert.equal(storage.writes.length, 1);
    assert.equal(storage.writes[0][0], "leilei.home.todo-paper.v1:2026-08-07:L");
    assert.match(storage.writes[0][1], /Changed/);
    assert.deepEqual(rendered.saved, [[
      { id: "l-1", author: "L", kind: "pending", text: "Changed" },
      { id: "l-2", author: "L", kind: "record", text: "Second" },
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
    const rendered = await renderTodoPaperDialog(harness, { storage });
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
