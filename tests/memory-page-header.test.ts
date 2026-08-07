import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { MemoryPageContent } from "../web/src/pages/MemoryPage.js";
import { DEFAULT_SETTINGS } from "../web/src/settings/types.js";

const memory = {
  id: "memory-1",
  category: "goal" as const,
  key: "current_goal",
  content: "Complete the focused milestone.",
  tags: ["focus"],
  source: "web",
  updated_at: "2026-08-07T12:00:00.000Z",
};

const api: WebApiClient = {
  async request<T>() {
    return {
      success: true,
      data: {
        user: { display_name: "Leilei" },
        memories: [memory],
        metadata: {
          count: 1,
          categories: ["goal"],
          tags: ["focus"],
        },
      },
    } as T;
  },
};

async function renderMemory() {
  const dom = new JSDOM('<main id="root"></main>', {
    url: "https://leilei-os.test/memory",
  });
  const prior = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const install = (name: PropertyKey, value: unknown) => {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
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
  install("MouseEvent", dom.window.MouseEvent);
  install("KeyboardEvent", dom.window.KeyboardEvent);
  install("PopStateEvent", dom.window.PopStateEvent);
  install("sessionStorage", dom.window.sessionStorage);
  install("React", React);
  install("IS_REACT_ACT_ENVIRONMENT", true);

  (dom.window.HTMLElement.prototype as unknown as {
    attachEvent(name: string, listener: EventListener): void;
    detachEvent(name: string, listener: EventListener): void;
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
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));

  const container = dom.window.document.querySelector<HTMLElement>("#root");
  assert.ok(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(MemoryPageContent, { api, settings: DEFAULT_SETTINGS }));
  });

  return {
    container,
    dom,
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

test("Memory active list uses the compact five-tool header", async () => {
  const page = await renderMemory();
  try {
    assert.equal(page.container.querySelector(".page-header"), null);
    assert.equal(page.container.querySelector(".memory-filters"), null);
    assert.equal(page.container.querySelector(".memory-page-title")?.textContent, "Memory");
    assert.match(page.container.querySelector(".memory-page-count")?.textContent ?? "", /1条记忆/);

    const labels = [...page.container.querySelectorAll<HTMLButtonElement>(".memory-page-tools button")]
      .map((button) => button.getAttribute("aria-label"));
    assert.deepEqual(labels, ["筛选分类", "筛选标签", "搜索记忆", "查看归档", "新增记忆"]);
  } finally {
    await page.cleanup();
  }
});

test("Memory header opens category menu and expandable search", async () => {
  const page = await renderMemory();
  try {
    const category = page.container.querySelector<HTMLButtonElement>('[aria-label="筛选分类"]');
    const search = page.container.querySelector<HTMLButtonElement>('[aria-label="搜索记忆"]');
    assert.ok(category);
    assert.ok(search);

    await React.act(async () => category.click());
    assert.ok(page.container.querySelector('[role="menu"][aria-label="Memory 分类"]'));

    await React.act(async () => search.click());
    assert.ok(page.container.querySelector('input[aria-label="搜索记忆"]'));
  } finally {
    await page.cleanup();
  }
});
