import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  MemoryPageContent,
  formatMemorySource,
} from "../web/src/pages/MemoryPage.js";
import {
  createMemoryDetailLocation,
} from "../web/src/pages/memory-location.js";
import {
  saveMemoryScrollPosition,
} from "../web/src/pages/memory-scroll-restoration.js";
import { DEFAULT_SETTINGS } from "../web/src/settings/types.js";

type Request = { path: string; init?: RequestInit };

const memory = {
  id: "memory-1",
  category: "goal" as const,
  key: "current_goal",
  content: "Complete the focused milestone without losing context.",
  tags: ["MCP", "focus"],
  source: "web",
  updated_at: "2026-07-28T00:00:00.000Z",
};

test("Memory source labels keep provenance read-only and legacy-safe", () => {
  assert.equal(formatMemorySource("web"), "网页创建");
  assert.equal(formatMemorySource("phase_2_validation"), "初始化数据");
  assert.equal(formatMemorySource("legacy-import-v0"), "其他来源");
});

function listResponse(memories = [memory]) {
  return {
    success: true as const,
    data: {
      user: { display_name: "Leilei" },
      memories,
      metadata: {
        count: memories.length,
        categories: ["goal" as const],
        tags: ["MCP", "focus"],
      },
    },
  };
}

function pendingApi() {
  const requests: Request[] = [];
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      return new Promise<T>(() => {});
    },
  };
  return { api, requests };
}

async function render(path: string, api: WebApiClient) {
  const dom = new JSDOM("<main id=\"root\"></main>", {
    url: `https://leilei-os.test${path}`,
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
  install("Node", dom.window.Node);
  install("Event", dom.window.Event);
  install("MouseEvent", dom.window.MouseEvent);
  install("PopStateEvent", dom.window.PopStateEvent);
  install("sessionStorage", dom.window.sessionStorage);
  install("React", React);
  install("IS_REACT_ACT_ENVIRONMENT", true);
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
    root.render(React.createElement(MemoryPageContent, {
      api,
      settings: DEFAULT_SETTINGS,
    }));
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

function assertNoList(container: Element) {
  assert.equal(
    container.querySelector("input[aria-label=\"搜索记忆\"]"),
    null,
  );
  assert.equal(container.querySelector(".memory-grid"), null);
  assert.doesNotMatch(container.textContent ?? "", /新增记忆/);
}

test("Memory detail refresh starts in detail loading and skips list request", async () => {
  const { api, requests } = pendingApi();
  const page = await render(
    createMemoryDetailLocation("memory-1", "/memory?q=goal"),
    api,
  );
  try {
    assert.match(page.container.textContent ?? "", /正在读取记忆/);
    assertNoList(page.container);
    assert.deepEqual(requests.map(({ path }) => path), ["/memory/memory-1"]);
  } finally {
    await page.cleanup();
  }
});

test("Memory detail success and failure never flash the list", async () => {
  for (const [api, expected, sourceVisible] of [
    [{
      async request<T>() {
        return { success: true, data: memory } as T;
      },
    } satisfies WebApiClient, /Complete the focused milestone/, true],
    [{
      async request<T>(): Promise<T> {
        throw new Error("private failure");
      },
    } satisfies WebApiClient, /该记忆不存在、无权访问或暂时不可用/, false],
  ] as const) {
    const page = await render("/memory?memory=memory-1", api);
    try {
      assert.match(page.container.textContent ?? "", expected);
      if (sourceVisible) {
        assert.match(page.container.textContent ?? "", /网页创建/);
      }
      assertNoList(page.container);
      assert.doesNotMatch(page.container.textContent ?? "", /private failure/);
    } finally {
      await page.cleanup();
    }
  }
});

test("Memory list search becomes a refresh-safe returnTo without breaking edit", async () => {
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/memory?q=goal") return listResponse() as T;
      if (path === "/memory/memory-1") {
        return { success: true, data: memory } as T;
      }
      throw new Error("unexpected request");
    },
  };
  const page = await render("/memory?q=goal", api);
  try {
    assert.match(page.container.textContent ?? "", /网页创建/);
    assert.equal(
      page.container.querySelector(
        "input[aria-label*=\"来源\"], select[aria-label*=\"来源\"]",
      ),
      null,
    );
    const edit = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "编辑");
    assert.ok(edit);
    await React.act(async () => {
      edit.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(page.window.location.pathname, "/memory");
    assert.equal(page.window.location.search, "?q=goal");
    assert.ok(
      page.container.querySelector("textarea"),
      "existing inline edit remains available",
    );

    const cancel = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "取消");
    assert.ok(cancel);
    await React.act(async () => {
      cancel.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    const detail = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "查看详情");
    assert.ok(detail);
    await React.act(async () => {
      detail.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });

    const parsed = new URLSearchParams(page.window.location.search);
    assert.equal(parsed.get("memory"), "memory-1");
    assert.equal(parsed.get("returnTo"), "/memory?q=goal");
    assert.deepEqual(
      requests.map(({ path }) => path),
      ["/memory?q=goal", "/memory/memory-1"],
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory in-page return restores the searched URL and saved scroll after list load", async () => {
  const returnTo = "/memory?q=goal";
  const api: WebApiClient = {
    async request<T>(path: string) {
      if (path === "/memory/memory-1") {
        return { success: true, data: memory } as T;
      }
      return listResponse() as T;
    },
  };
  const page = await render(
    createMemoryDetailLocation("memory-1", returnTo),
    api,
  );
  const scrolls: number[] = [];
  page.window.scrollTo = (options?: ScrollToOptions | number) => {
    if (typeof options === "object") scrolls.push(options.top ?? 0);
  };
  saveMemoryScrollPosition(page.window.sessionStorage, returnTo, 640);
  try {
    const back = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "返回记忆列表");
    assert.ok(back);
    await React.act(async () => {
      back.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await new Promise((resolve) => page.window.setTimeout(resolve, 5));
    });

    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      returnTo,
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"搜索记忆\"]",
      )?.value,
      "goal",
    );
    assert.ok(scrolls.includes(640));
  } finally {
    await page.cleanup();
  }
});

test("Memory popstate switches list and detail modes without stale requests", async () => {
  const { api, requests } = pendingApi();
  const page = await render("/memory?q=goal", api);
  try {
    const listSignal = requests[0]?.init?.signal;
    await React.act(async () => {
      page.window.history.pushState(
        null,
        "",
        createMemoryDetailLocation("memory-1", "/memory?q=goal"),
      );
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });

    assert.equal(listSignal?.aborted, true);
    assert.match(page.container.textContent ?? "", /正在读取记忆/);
    assertNoList(page.container);
    assert.equal(requests.at(-1)?.path, "/memory/memory-1");
    const detailSignal = requests.at(-1)?.init?.signal;

    await React.act(async () => {
      page.window.history.pushState(null, "", "/memory?q=goal");
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });
    assert.equal(detailSignal?.aborted, true);
    assert.equal(requests.at(-1)?.path, "/memory?q=goal");
  } finally {
    await page.cleanup();
  }
});

test("Memory category filter initializes from URL, requests AND filters, and clears category", async () => {
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      return listResponse() as T;
    },
  };
  const page = await render(
    "/memory?q=focus&category=goal",
    api,
  );
  try {
    const search = page.container.querySelector<HTMLInputElement>(
      "input[aria-label=\"搜索记忆\"]",
    );
    const category = page.container.querySelector<HTMLSelectElement>(
      "select[aria-label=\"按分类筛选\"]",
    );
    assert.equal(search?.value, "focus");
    assert.equal(category?.value, "goal");
    assert.deepEqual(
      [...(category?.options ?? [])].map(({ value }) => value),
      ["", "goal"],
      "options come only from the authenticated response metadata",
    );
    assert.equal(
      requests[0]?.path,
      "/memory?q=focus&category=goal",
    );

    assert.ok(category);
    await React.act(async () => {
      category.value = "";
      category.dispatchEvent(new page.window.Event("change", {
        bubbles: true,
      }));
      await Promise.resolve();
    });

    assert.equal(page.window.location.search, "?q=focus");
    assert.equal(requests.at(-1)?.path, "/memory?q=focus");
  } finally {
    await page.cleanup();
  }
});

test("Memory filtered detail return restores q, category, tag, and scroll position", async () => {
  const returnTo = "/memory?q=focus&category=goal&tag=MCP";
  const api: WebApiClient = {
    async request<T>(path: string) {
      if (path === "/memory/memory-1") {
        return { success: true, data: memory } as T;
      }
      return listResponse() as T;
    },
  };
  const page = await render(
    createMemoryDetailLocation("memory-1", returnTo),
    api,
  );
  const scrolls: number[] = [];
  page.window.scrollTo = (options?: ScrollToOptions | number) => {
    if (typeof options === "object") scrolls.push(options.top ?? 0);
  };
  saveMemoryScrollPosition(page.window.sessionStorage, returnTo, 420);
  try {
    const back = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "返回记忆列表");
    assert.ok(back);
    await React.act(async () => {
      back.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await new Promise((resolve) => page.window.setTimeout(resolve, 5));
    });

    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      returnTo,
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"搜索记忆\"]",
      )?.value,
      "focus",
    );
    assert.equal(
      page.container.querySelector<HTMLSelectElement>(
        "select[aria-label=\"按分类筛选\"]",
      )?.value,
      "goal",
    );
    assert.equal(
      page.container.querySelector<HTMLSelectElement>(
        "select[aria-label=\"按标签筛选\"]",
      )?.value,
      "MCP",
    );
    assert.ok(scrolls.includes(420));
  } finally {
    await page.cleanup();
  }
});

test("Memory exact tag filter restores from URL and clearing it preserves q and category", async () => {
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      return listResponse() as T;
    },
  };
  const page = await render(
    "/memory?q=focus&category=goal&tag=MCP",
    api,
  );
  try {
    const tag = page.container.querySelector<HTMLSelectElement>(
      "select[aria-label=\"按标签筛选\"]",
    );
    assert.equal(tag?.value, "MCP");
    assert.equal(
      requests[0]?.path,
      "/memory?q=focus&category=goal&tag=MCP",
    );
    assert.match(page.container.textContent ?? "", /#MCP/);
    assert.match(page.container.textContent ?? "", /#focus/);

    assert.ok(tag);
    await React.act(async () => {
      tag.value = "";
      tag.dispatchEvent(new page.window.Event("change", {
        bubbles: true,
      }));
      await Promise.resolve();
    });

    assert.equal(
      page.window.location.search,
      "?q=focus&category=goal",
    );
    assert.equal(
      requests.at(-1)?.path,
      "/memory?q=focus&category=goal",
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory detail edit loads and submits existing tags", async () => {
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/memory/memory-1") {
        return { success: true, data: memory } as T;
      }
      return listResponse() as T;
    },
  };
  const page = await render("/memory?memory=memory-1", api);
  try {
    const edit = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "编辑");
    assert.ok(edit);
    await React.act(async () => {
      edit.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });

    const tags = page.container.querySelector<HTMLInputElement>(
      "input[aria-label=\"编辑记忆标签\"]",
    );
    assert.equal(tags?.value, "MCP, focus");
    const save = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "保存修改");
    assert.ok(save);
    await React.act(async () => {
      save.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });

    const update = requests.find(({ init }) => init?.method === "PATCH");
    assert.ok(update?.init?.body);
    assert.deepEqual(JSON.parse(String(update.init.body)), {
      id: "memory-1",
      content: memory.content,
      tags: ["MCP", "focus"],
    });
  } finally {
    await page.cleanup();
  }
});
