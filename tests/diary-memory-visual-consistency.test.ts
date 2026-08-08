import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { DiaryPaperMetadataEditor } from "../web/src/pages/DiaryPaperEditor.js";
import {
  formatDiaryPaperDate,
  formatDiaryRowDate,
} from "../web/src/pages/diary-presentation.js";
import {
  formatMemoryPaperDate,
  formatMemoryRowDate,
} from "../web/src/pages/memory-presentation.js";

test("Diary and Memory lists use M/D while paper dates use YYYY.MM.DD", () => {
  assert.equal(formatDiaryRowDate("2026-08-08"), "8/8");
  assert.equal(formatDiaryPaperDate("2026-08-08"), "2026.08.08");

  const timestamp = new Date(2026, 7, 8, 12, 0, 0).toISOString();
  assert.equal(formatMemoryRowDate(timestamp), "8/8");
  assert.equal(formatMemoryPaperDate(timestamp), "2026.08.08");
});

test("Diary paper mood input sizes to its content instead of reserving a wide blank field", async () => {
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
  install("Node", dom.window.Node);
  install("Event", dom.window.Event);
  install("React", React);
  install("IS_REACT_ACT_ENVIRONMENT", true);

  const node = dom.window.document.querySelector("#root");
  assert.ok(node);
  const root = createRoot(node);

  try {
    await React.act(async () => {
      root.render(React.createElement(DiaryPaperMetadataEditor, {
        moodValue: "平静",
        tagsValue: "生活, 八月",
        disabled: false,
        onMoodChange() {},
        onTagsChange() {},
      }));
    });

    const mood = node.querySelector<HTMLInputElement>(
      'input[aria-label="日记心情"]',
    );
    const tags = node.querySelector<HTMLInputElement>(
      'input[aria-label="日记标签"]',
    );
    assert.ok(mood);
    assert.ok(tags);
    assert.equal(mood.style.width, "4ch");
    assert.ok(Number.parseInt(tags.style.width, 10) >= 4);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("Memory Archive uses the same English Return label as Diary", async () => {
  const source = await readFile(
    new URL("../web/src/pages/MemoryPage.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /className="memory-archive-back"[\s\S]{0,120}>\s*Return\s*<\/button>/,
  );
});
