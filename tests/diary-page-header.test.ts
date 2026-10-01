import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { DiaryPageHeader } from "../web/src/pages/DiaryPageHeader.js";

async function renderHeader() {
  const dom = new JSDOM("<main id=\"root\"></main>");
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
  install("Node", dom.window.Node);
  install("Event", dom.window.Event);
  install("MouseEvent", dom.window.MouseEvent);
  install("React", React);
  install("IS_REACT_ACT_ENVIRONMENT", true);

  const rootNode = dom.window.document.querySelector("#root");
  assert.ok(rootNode);
  const root = createRoot(rootNode);
  await React.act(async () => {
    root.render(React.createElement(DiaryPageHeader, {
      count: 17,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-08",
      moodDraft: "calm",
      tagDraft: "work",
      searchDraft: "",
      filterError: "",
      busy: false,
      onDateFromChange() {},
      onDateToChange() {},
      onMoodChange() {},
      onTagChange() {},
      onSearchChange() {},
      onOpenArchive() {},
      onCreate() {},
    }));
  });

  return {
    container: rootNode,
    window: dom.window,
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test("Diary page header keeps the approved six-tool order", async () => {
  const page = await renderHeader();
  try {
    assert.match(page.container.textContent ?? "", /Diary/);
    assert.match(page.container.textContent ?? "", /17篇日记/);
    assert.deepEqual(
      [...page.container.querySelectorAll(".memory-page-tools button")]
        .map((button) => button.getAttribute("aria-label")),
      [
        "按日期筛选",
        "按心情筛选",
        "按标签筛选",
        "搜索日记",
        "查看归档",
        "新增日记",
      ],
    );
  } finally {
    await page.cleanup();
  }
});

test("Diary date, mood and tag tools expose the existing free-text/date filters", async () => {
  const page = await renderHeader();
  try {
    for (const label of ["按日期筛选", "按心情筛选", "按标签筛选"]) {
      const button = page.container.querySelector<HTMLButtonElement>(
        `button[aria-label="${label}"]`,
      );
      assert.ok(button);
      await React.act(async () => {
        button.dispatchEvent(new page.window.MouseEvent("click", {
          bubbles: true,
        }));
      });

      if (label === "按日期筛选") {
        assert.equal(
          page.container.querySelector<HTMLInputElement>(
            'input[aria-label="Diary 自定义开始时间"]',
          )?.value,
          "2026-08-01",
        );
        assert.equal(
          page.container.querySelector<HTMLInputElement>(
            'input[aria-label="Diary 自定义结束时间"]',
          )?.value,
          "2026-08-08",
        );
      } else {
        assert.ok(
          page.container.querySelector(
            `input[aria-label="${label}"]`,
          ),
        );
      }
    }
  } finally {
    await page.cleanup();
  }
});
