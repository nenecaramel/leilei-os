import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { DiaryPageContent } from "../web/src/pages/DiaryPage.js";
import { createDiaryArchiveLocation } from "../web/src/pages/diary-location.js";

const diary = {
  id: "diary-1",
  title: "August note",
  content: "A full Diary entry.",
  date: "2026-08-08",
  tags: ["work", "MCP"],
  mood: "calm",
  created_at: "2026-08-08T01:00:00.000Z",
  updated_at: "2026-08-08T02:00:00.000Z",
};

const julyDiary = {
  ...diary,
  id: "diary-2",
  title: "July note",
  date: "2026-07-31",
  tags: [],
  mood: null,
};

async function renderMobile(path: string, api: WebApiClient) {
  const dom = new JSDOM("<main id=\"root\"></main>", {
    url: `https://leilei-os.test${path}`,
  });

  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      media: "(max-width: 760px)",
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return true; },
    }),
  });

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
  install("InputEvent", dom.window.InputEvent);
  install("Node", dom.window.Node);
  install("Event", dom.window.Event);
  install("MouseEvent", dom.window.MouseEvent);
  install("PopStateEvent", dom.window.PopStateEvent);
  install("sessionStorage", dom.window.sessionStorage);
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

  dom.window.scrollTo = () => {};
  dom.window.requestAnimationFrame = (callback) =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  install(
    "requestAnimationFrame",
    dom.window.requestAnimationFrame.bind(dom.window),
  );

  const container = dom.window.document.querySelector("#root");
  assert.ok(container);
  const root = createRoot(container);

  await React.act(async () => {
    root.render(React.createElement(DiaryPageContent, {
      api,
    }));
  });
  await React.act(async () => {
    await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
  });

  return {
    container,
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

function listApi(count = 128): WebApiClient {
  return {
    async request<T>(path: string) {
      if (path === "/diary") {
        return {
          success: true,
          data: {
            diaries: [diary, julyDiary],
            metadata: { count },
          },
        } as T;
      }
      if (path === "/diary/diary-1") {
        return { success: true, data: diary } as T;
      }
      if (path === "/diary/archived") {
        return {
          success: true,
          data: {
            diaries: [diary],
            metadata: { count: 23 },
          },
        } as T;
      }
      if (path === "/diary/archived/diary-1") {
        return { success: true, data: diary } as T;
      }
      throw new Error(`unexpected request ${path}`);
    },
  };
}

test("mobile Diary matches Memory header and month-row hierarchy", async () => {
  const page = await renderMobile("/diary", listApi());
  try {
    assert.match(page.container.textContent ?? "", /128篇日记/);

    const labels = [
      ...page.container.querySelectorAll<HTMLElement>(
        ".memory-page-tools button",
      ),
    ].map((button) => button.getAttribute("aria-label"));

    assert.deepEqual(labels, [
      "按日期筛选",
      "按心情筛选",
      "按标签筛选",
      "搜索日记",
      "查看归档",
      "新增日记",
    ]);

    assert.match(page.container.textContent ?? "", /2026年8月/);
    assert.match(page.container.textContent ?? "", /2026年7月/);

    const row = page.container.querySelector<HTMLElement>(
      '[data-diary-id="diary-1"]',
    );
    assert.ok(row);
    assert.match(row.textContent ?? "", /August note/);
    assert.match(row.textContent ?? "", /8\/8/);
    assert.match(row.textContent ?? "", /calm · #work #MCP/);

    const emptyMetadataRow = page.container.querySelector<HTMLElement>(
      '[data-diary-id="diary-2"]',
    );
    assert.ok(emptyMetadataRow);

    const emptyMetadata = emptyMetadataRow.querySelector(".memory-row-meta");
    assert.ok(emptyMetadata);

    const slots = [...emptyMetadata.children];
    assert.equal(slots.length, 2);
    assert.equal(slots[0]?.textContent, "7/31");
    assert.equal(slots[1]?.textContent, "");
  } finally {
    await page.cleanup();
  }
});

test("mobile Diary create uses the shared paper and date is editable from top-left", async () => {
  const page = await renderMobile("/diary", listApi());
  try {
    const create = page.container.querySelector<HTMLButtonElement>(
      'button[aria-label="新增日记"]',
    );
    assert.ok(create);

    await React.act(async () => {
      create.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });

    const paper = page.container.querySelector("#diary-create-paper");
    assert.ok(paper);
    assert.ok(paper.querySelector('input[aria-label="日记日期"][type="date"]'));
    assert.ok(paper.querySelector('input[aria-label="日记标题"]'));
    assert.ok(paper.querySelector('textarea[aria-label="日记正文"]'));
    assert.ok(paper.querySelector('input[aria-label="日记心情"]'));
    assert.ok(paper.querySelector('input[aria-label="日记标签"]'));
    assert.match(paper.textContent ?? "", /取消·保存/);
  } finally {
    await page.cleanup();
  }
});

test("mobile Diary detail keeps the loaded list stationary beneath the paper", async () => {
  const page = await renderMobile("/diary", listApi());
  const scrolls: number[] = [];
  page.window.scrollTo = (options?: ScrollToOptions | number) => {
    if (typeof options === "object") scrolls.push(options.top ?? 0);
  };

  try {
    const row = page.container.querySelector<HTMLButtonElement>(
      '[data-diary-id="diary-1"]',
    );
    assert.ok(row);

    await React.act(async () => {
      row.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await new Promise((resolve) => page.window.setTimeout(resolve, 0));
    });

    assert.ok(page.container.querySelector("#diary-detail-paper"));
    assert.ok(page.container.querySelector('[data-diary-id="diary-1"]'));
    assert.deepEqual(scrolls, []);
  } finally {
    await page.cleanup();
  }
});

test("mobile Diary Archive exposes only Return at page-header level", async () => {
  const page = await renderMobile(
    createDiaryArchiveLocation("/diary?q=goal"),
    listApi(),
  );
  try {
    const header = page.container.querySelector(".diary-archive-header");
    assert.ok(header);
    assert.match(header.textContent ?? "", /Archive/);
    assert.match(header.textContent ?? "", /23篇日记/);
    assert.deepEqual(
      [...header.querySelectorAll("button")].map((button) =>
        button.textContent?.trim()
      ),
      ["Return"],
    );
    assert.equal(header.querySelector(".memory-page-tools"), null);
  } finally {
    await page.cleanup();
  }
});
