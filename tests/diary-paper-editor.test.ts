import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import {
  DiaryPaperDateEditor,
  DiaryPaperEditor,
  DiaryPaperMetadataEditor,
} from "../web/src/pages/DiaryPaperEditor.js";

async function withDom(
  element: React.ReactElement,
  check: (root: Element, window: Window) => void | Promise<void>,
) {
  const dom = new JSDOM('<main id="root"></main>');
  const prior = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const install = (name: PropertyKey, value: unknown) => {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
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

  const node = dom.window.document.querySelector("#root");
  assert.ok(node);
  const root = createRoot(node);
  try {
    await React.act(async () => root.render(element));
    await check(node, dom.window);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("Diary paper editor exposes title and content as direct paper fields", async () => {
  await withDom(
    React.createElement(DiaryPaperEditor, {
      title: "Title",
      content: "Body",
      disabled: false,
      onTitleChange() {},
      onContentChange() {},
    }),
    (root) => {
      assert.equal(
        root.querySelector<HTMLInputElement>('input[aria-label="日记标题"]')
          ?.value,
        "Title",
      );
      assert.equal(
        root.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="日记正文"]',
        )?.value,
        "Body",
      );
      assert.equal(root.querySelector("textarea")?.placeholder, "Content");
    },
  );
});

test("Diary paper date is visible text backed by a native date input", async () => {
  await withDom(
    React.createElement(DiaryPaperDateEditor, {
      value: "2026-08-08",
      disabled: false,
      onChange() {},
    }),
    (root) => {
      assert.match(root.textContent ?? "", /2026\.08\.08/);
      const input = root.querySelector<HTMLInputElement>(
        'input[aria-label="日记日期"][type="date"]',
      );
      assert.ok(input);
      assert.equal(input.value, "2026-08-08");
    },
  );
});

test("Diary paper metadata keeps mood and tags as free text", async () => {
  await withDom(
    React.createElement(DiaryPaperMetadataEditor, {
      moodValue: "calm",
      tagsValue: "work, MCP",
      disabled: false,
      onMoodChange() {},
      onTagsChange() {},
    }),
    (root) => {
      const mood = root.querySelector<HTMLInputElement>(
        'input[aria-label="日记心情"]',
      );
      const tags = root.querySelector<HTMLInputElement>(
        'input[aria-label="日记标签"]',
      );
      assert.equal(mood?.value, "calm");
      assert.equal(mood?.style.width, "6ch");
      assert.equal(tags?.value, "work, MCP");
      assert.equal(tags?.style.width, "11ch");
    },
  );
});

test("shared paper body remeasures wrapped content when the viewport changes", async () => {
  await withDom(
    React.createElement(DiaryPaperEditor, {
      title: "Title",
      content: "A long body keeps its content after rotation",
      disabled: false,
      onTitleChange() {},
      onContentChange() {},
    }),
    async (root, window) => {
      const editor = root.querySelector<HTMLTextAreaElement>("textarea")!;
      Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get: () => 600,
      });
      await React.act(async () =>
        window.dispatchEvent(new window.Event("resize")),
      );
      assert.equal(editor.style.height, "600px");
      assert.equal(
        editor.value,
        "A long body keeps its content after rotation",
      );
    },
  );
});
