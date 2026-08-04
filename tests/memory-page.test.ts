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
  createArchivedMemoryDetailLocation,
  createMemoryArchiveLocation,
  createMemoryDetailLocation,
} from "../web/src/pages/memory-location.js";
import {
  saveMemoryScrollPosition,
} from "../web/src/pages/memory-scroll-restoration.js";
import { DEFAULT_SETTINGS } from "../web/src/settings/types.js";

type Request = { path: string; init?: RequestInit };
type Deferred<T> = {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

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

test("Dashboard quick-create intent opens Memory form and focuses Key once", async () => {
  const page = await render("/memory", pendingApi().api, { quickCreate: "memory", preserved: true });
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const key = page.container.querySelector<HTMLInputElement>('input[placeholder="Key"]');
    assert.ok(key);
    assert.equal(page.window.history.state.quickCreate, undefined);
    assert.equal(page.window.history.state.preserved, true);
    assert.equal(page.window.document.activeElement, key);
  } finally {
    await page.cleanup();
  }
});

test("Memory detail safely consumes quick-create without opening a hidden form", async () => {
  const page = await render(createMemoryDetailLocation("memory-1", "/memory"), pendingApi().api, { quickCreate: "memory" });
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(page.container.querySelector('input[placeholder="Key"]'), null);
    assert.equal(page.window.history.state.quickCreate, undefined);
  } finally {
    await page.cleanup();
  }
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

function archivedResponse(memories = [memory]) {
  return {
    success: true as const,
    data: {
      memories,
      metadata: {
        count: memories.length,
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

async function render(path: string, api: WebApiClient, historyState?: unknown) {
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
  install(
    "requestAnimationFrame",
    dom.window.requestAnimationFrame.bind(dom.window),
  );

  const container = dom.window.document.querySelector("#root");
  assert.ok(container);
  if (historyState !== undefined) dom.window.history.replaceState(historyState, "", path);
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

function hasMemoryListHeading(container: Element): boolean {
  return [...container.querySelectorAll(".memory-message h2")]
    .some((heading) => heading.textContent === "记忆列表");
}

test("Memory populated list has a separate heading and empty list does not", async () => {
  const populated = await render("/memory", {
    async request<T>() {
      return listResponse() as T;
    },
  });
  try {
    assert.equal(hasMemoryListHeading(populated.container), true);
    assert.match(
      populated.container.textContent ?? "",
      /共 1 条，按更新时间从新到旧排列。/,
    );
    assert.doesNotMatch(
      populated.container.textContent ?? "",
      /显示 1 条/,
    );
    const cardButtons = [
      ...populated.container.querySelectorAll(".memory-card button"),
    ].map((button) => button.textContent);
    assert.deepEqual(cardButtons, ["查看详情"]);
    assert.doesNotMatch(
      populated.container.querySelector(".memory-card")?.textContent ?? "",
      /编辑|归档/,
    );
    assert.equal(
      populated.container.querySelector(".memory-card textarea"),
      null,
    );
  } finally {
    await populated.cleanup();
  }

  const empty = await render("/memory", {
    async request<T>() {
      return listResponse([]) as T;
    },
  });
  try {
    assert.equal(hasMemoryListHeading(empty.container), false);
    assert.match(
      empty.container.textContent ?? "",
      /没有找到记忆/,
    );
  } finally {
    await empty.cleanup();
  }
});

test("Memory active detail uses archive wording and calls the existing endpoint once", async () => {
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (init?.method === "DELETE") {
        throw new Error("archive failed");
      }
      if (path === "/memory/memory-1") {
        return { success: true, data: memory } as T;
      }
      return listResponse() as T;
    },
  };
  const page = await render(
    createMemoryDetailLocation("memory-1", "/memory?q=goal"),
    api,
  );
  const confirmations: string[] = [];
  page.window.confirm = (message) => {
    confirmations.push(String(message));
    return true;
  };
  try {
    const edit = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "编辑");
    const archive = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "归档");
    const returns = [...page.container.querySelectorAll("button")]
      .filter((button) => button.textContent === "返回记忆列表");
    assert.ok(edit);
    assert.ok(archive);
    assert.equal(returns.length, 2);
    assert.deepEqual(
      [...page.container.querySelectorAll(".memory-detail > button")]
        .map((button) => button.textContent),
      ["编辑", "归档", "返回记忆列表"],
    );
    assert.doesNotMatch(page.container.textContent ?? "", /删除/);

    await React.act(async () => {
      archive.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      archive.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });

    assert.deepEqual(confirmations, ["确定归档“current goal”吗？"]);
    assert.match(
      page.container.textContent ?? "",
      /归档记忆失败，请稍后重试。/,
    );
    assert.doesNotMatch(page.container.textContent ?? "", /删除/);
    assert.equal(
      requests.filter(({ init }) => init?.method === "DELETE").length,
      1,
    );
    assert.equal(
      requests.find(({ init }) => init?.method === "DELETE")?.path,
      "/memory",
    );
    assert.equal(
      page.window.location.search,
      "?memory=memory-1&returnTo=%2Fmemory%3Fq%3Dgoal",
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory detail archive returns to the exact filtered list and editing hides archive", async () => {
  const returnTo = "/memory?q=goal&category=goal&tag=MCP";
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/memory/memory-1") {
        return { success: true, data: memory } as T;
      }
      if (init?.method === "DELETE") {
        return { success: true, data: {} } as T;
      }
      return listResponse() as T;
    },
  };
  const page = await render(
    createMemoryDetailLocation("memory-1", returnTo),
    api,
  );
  page.window.confirm = () => true;
  try {
    const edit = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "编辑");
    assert.ok(edit);
    await React.act(async () => {
      edit.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(
      [...page.container.querySelectorAll("button")]
        .some((button) => button.textContent === "归档"),
      false,
    );

    const cancel = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "取消");
    assert.ok(cancel);
    await React.act(async () => {
      cancel.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    const archive = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "归档");
    assert.ok(archive);
    await React.act(async () => {
      archive.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });

    assert.equal(
      requests.filter(({ init }) => init?.method === "DELETE").length,
      1,
    );
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      returnTo,
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory detail cancelled archive confirmation performs no request", async () => {
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      return { success: true, data: memory } as T;
    },
  };
  const page = await render(
    createMemoryDetailLocation("memory-1", "/memory"),
    api,
  );
  page.window.confirm = () => false;
  try {
    const archive = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "归档");
    assert.ok(archive);
    await React.act(async () => {
      archive.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(
      requests.filter(({ init }) => init?.method === "DELETE").length,
      0,
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory archived mode renders read-only cards and returns to the full list URL", async () => {
  const returnTo = "/memory?q=goal&category=goal&tag=MCP";
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/memory/archived") {
        return archivedResponse() as T;
      }
      return listResponse() as T;
    },
  };
  const page = await render(
    createMemoryArchiveLocation(returnTo),
    api,
  );
  try {
    assert.equal(requests[0]?.path, "/memory/archived");
    assert.match(page.container.textContent ?? "", /已归档记忆/);
    assert.match(
      page.container.textContent ?? "",
      /共 1 条，按更新时间从新到旧排列。/,
    );
    assert.match(page.container.textContent ?? "", /Goal/);
    assert.match(page.container.textContent ?? "", /#MCP/);
    assert.match(page.container.textContent ?? "", /网页创建/);
    assert.match(
      page.container.textContent ?? "",
      /Complete the focused milestone/,
    );
    for (const forbidden of [
      "编辑",
      "归档中…",
      "恢复",
      "永久删除",
    ]) {
      assert.equal(
        [...page.container.querySelectorAll("button")]
          .some((button) => button.textContent === forbidden),
        false,
      );
    }

    const back = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "返回记忆列表");
    assert.ok(back);
    await React.act(async () => {
      back.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      returnTo,
    );
    assert.equal(requests.at(-1)?.path, returnTo);
  } finally {
    await page.cleanup();
  }
});

test("Memory archived card opens a read-only archived detail and returns to archive list", async () => {
  const activeList = "/memory?q=goal&category=goal&tag=MCP";
  const archiveList = createMemoryArchiveLocation(activeList);
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/memory/archived") {
        return archivedResponse() as T;
      }
      if (path === "/memory/archived/memory-1") {
        return { success: true, data: memory } as T;
      }
      return listResponse() as T;
    },
  };
  const page = await render(archiveList, api);

  try {
    const open = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "查看详情");
    assert.ok(open);
    await React.act(async () => {
      open.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });

    assert.equal(
      requests.at(-1)?.path,
      "/memory/archived/memory-1",
    );
    assert.match(page.container.textContent ?? "", /已归档记忆/);
    assert.match(page.container.textContent ?? "", /current goal/i);
    assert.match(
      page.container.textContent ?? "",
      /Complete the focused milestone/,
    );
    for (const forbidden of ["编辑", "归档", "永久删除"]) {
      assert.equal(
        [...page.container.querySelectorAll("button")]
          .some((button) => button.textContent === forbidden),
        false,
      );
    }

    const back = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "返回归档列表");
    assert.ok(back);
    await React.act(async () => {
      back.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      archiveList,
    );
    assert.equal(requests.at(-1)?.path, "/memory/archived");
  } finally {
    await page.cleanup();
  }
});

test("Memory archived detail refresh requests only archived detail", async () => {
  const archiveList = createMemoryArchiveLocation(
    "/memory?q=goal",
  );
  const { api, requests } = pendingApi();
  const page = await render(
    createArchivedMemoryDetailLocation("memory-1", archiveList),
    api,
  );

  try {
    assert.match(
      page.container.textContent ?? "",
      /正在读取已归档记忆/,
    );
    assertNoList(page.container);
    assert.deepEqual(
      requests.map(({ path }) => path),
      ["/memory/archived/memory-1"],
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory archived detail error retries without exposing list actions", async () => {
  let attempts = 0;
  const api: WebApiClient = {
    async request<T>(path: string) {
      assert.equal(path, "/memory/archived/memory-1");
      attempts += 1;
      throw new Error("private archived detail");
    },
  };
  const page = await render(
    createArchivedMemoryDetailLocation(
      "memory-1",
      createMemoryArchiveLocation("/memory"),
    ),
    api,
  );

  try {
    assert.match(
      page.container.textContent ?? "",
      /无法读取已归档记忆/,
    );
    assert.doesNotMatch(
      page.container.textContent ?? "",
      /private archived detail/,
    );
    assertNoList(page.container);
    const retry = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "重新加载");
    assert.ok(retry);
    await React.act(async () => {
      retry.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });
    assert.equal(attempts, 2);
  } finally {
    await page.cleanup();
  }
});

test("Memory archived detail restore is single-flight and returns to exact active filters", async () => {
  const activeList = "/memory?q=goal&category=goal&tag=MCP";
  const archiveList = createMemoryArchiveLocation(activeList);
  let finishRestore!: () => void;
  const restorePending = new Promise<void>((resolve) => {
    finishRestore = resolve;
  });
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/memory/archived/memory-1") {
        return { success: true, data: memory } as T;
      }
      if (path === "/memory/archived/memory-1/restore") {
        await restorePending;
        return { success: true } as T;
      }
      if (path === activeList) return listResponse() as T;
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  const page = await render(
    createArchivedMemoryDetailLocation("memory-1", archiveList),
    api,
  );

  try {
    const restore = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "恢复");
    assert.ok(restore);
    await React.act(async () => {
      restore.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      restore.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });
    assert.equal(
      requests.filter(
        ({ path }) =>
          path === "/memory/archived/memory-1/restore",
      ).length,
      1,
    );
    assert.match(page.container.textContent ?? "", /恢复中…/);
    const back = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "返回归档列表");
    assert.ok(back?.disabled);

    await React.act(async () => {
      finishRestore();
      await restorePending;
      await Promise.resolve();
    });

    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      activeList,
    );
    assert.equal(requests.at(-1)?.path, activeList);
    const filters = new URLSearchParams(page.window.location.search);
    assert.equal(filters.get("q"), "goal");
    assert.equal(filters.get("category"), "goal");
    assert.equal(filters.get("tag"), "MCP");
    assert.equal(
      page.window.history.state,
      null,
      "the invalid archived detail entry is replaced",
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory archived detail restore failure stays read-only and safely retryable", async () => {
  const detailUrl = createArchivedMemoryDetailLocation(
    "memory-1",
    createMemoryArchiveLocation("/memory?q=goal"),
  );
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/memory/archived/memory-1") {
        return { success: true, data: memory } as T;
      }
      if (path === "/memory/archived/memory-1/restore") {
        throw new Error("private restore detail");
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  const page = await render(detailUrl, api);

  try {
    const restore = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "恢复");
    assert.ok(restore);
    await React.act(async () => {
      restore.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      detailUrl,
    );
    assert.match(
      page.container.textContent ?? "",
      /恢复记忆失败，请稍后重试。/,
    );
    assert.doesNotMatch(
      page.container.textContent ?? "",
      /private restore detail/,
    );
    assert.ok(
      [...page.container.querySelectorAll("button")]
        .some((button) => button.textContent === "恢复"),
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory archived entry uses stable History and browser back restores the active list", async () => {
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/memory/archived") {
        return archivedResponse() as T;
      }
      return listResponse() as T;
    },
  };
  const page = await render("/memory?q=goal", api);
  try {
    const entry = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "查看归档");
    assert.ok(entry);
    await React.act(async () => {
      entry.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });
    const archiveParameters = new URLSearchParams(
      page.window.location.search,
    );
    assert.equal(archiveParameters.get("view"), "archived");
    assert.equal(
      archiveParameters.get("returnTo"),
      "/memory?q=goal",
    );
    assert.equal(requests.at(-1)?.path, "/memory/archived");

    await React.act(async () => {
      const moved = new Promise<void>((resolve) => {
        page.window.addEventListener(
          "popstate",
          () => resolve(),
          { once: true },
        );
      });
      page.window.history.back();
      await moved;
      await new Promise((resolve) =>
        page.window.setTimeout(resolve, 5),
      );
    });

    assert.equal(page.window.location.search, "?q=goal");
    assert.equal(requests.at(-1)?.path, "/memory?q=goal");
    assert.ok(
      page.container.querySelector(
        "input[aria-label=\"搜索记忆\"]",
      ),
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory browser history restores archive list then the exact filtered active list", async () => {
  const activeList = "/memory?q=goal&category=goal&tag=MCP";
  const requests: Request[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/memory/archived") {
        return archivedResponse() as T;
      }
      if (path === "/memory/archived/memory-1") {
        return { success: true, data: memory } as T;
      }
      if (path === activeList) {
        return listResponse() as T;
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  const page = await render(activeList, api);

  const goBack = async () => {
    await React.act(async () => {
      const moved = new Promise<void>((resolve) => {
        page.window.addEventListener(
          "popstate",
          () => resolve(),
          { once: true },
        );
      });
      page.window.history.back();
      await moved;
      await new Promise((resolve) =>
        page.window.setTimeout(resolve, 5),
      );
    });
  };

  try {
    const archiveEntry = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "查看归档");
    assert.ok(archiveEntry);
    await React.act(async () => {
      archiveEntry.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });

    const detailEntry = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "查看详情");
    assert.ok(detailEntry);
    await React.act(async () => {
      detailEntry.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });
    assert.equal(
      requests.at(-1)?.path,
      "/memory/archived/memory-1",
    );

    await goBack();
    assert.equal(requests.at(-1)?.path, "/memory/archived");
    assert.match(page.container.textContent ?? "", /已归档记忆/);

    await goBack();
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      activeList,
    );
    assert.equal(requests.at(-1)?.path, activeList);
    const restored = new URLSearchParams(page.window.location.search);
    assert.equal(restored.get("q"), "goal");
    assert.equal(restored.get("category"), "goal");
    assert.equal(restored.get("tag"), "MCP");
    assert.equal(
      requests.some(({ path }) => path === "/memory/memory-1"),
      false,
    );
  } finally {
    await page.cleanup();
  }
});

test("Memory archived mode has distinct loading, empty, and error states", async () => {
  const loading = await render(
    createMemoryArchiveLocation("/memory"),
    pendingApi().api,
  );
  try {
    assert.match(loading.container.textContent ?? "", /正在读取归档/);
    assert.equal(
      loading.container.querySelector(
        "input[aria-label=\"搜索记忆\"]",
      ),
      null,
    );
  } finally {
    await loading.cleanup();
  }

  for (const [api, expected] of [
    [{
      async request<T>() {
        return archivedResponse([]) as T;
      },
    } satisfies WebApiClient, /还没有归档记忆/],
    [{
      async request<T>(): Promise<T> {
        throw new Error("private archive failure");
      },
    } satisfies WebApiClient, /暂时无法读取归档/],
  ] as const) {
    const page = await render(
      createMemoryArchiveLocation("/memory"),
      api,
    );
    try {
      assert.match(page.container.textContent ?? "", expected);
      assert.doesNotMatch(
        page.container.textContent ?? "",
        /private archive failure/,
      );
      assert.equal(
        page.container.querySelector(
          "input[aria-label=\"搜索记忆\"]",
        ),
        null,
      );
    } finally {
      await page.cleanup();
    }
  }
});

test("Memory detail refresh starts in detail loading and skips list request", async () => {
  const { api, requests } = pendingApi();
  const page = await render(
    createMemoryDetailLocation("memory-1", "/memory?q=goal"),
    api,
  );
  try {
    assert.match(page.container.textContent ?? "", /正在读取记忆/);
    assertNoList(page.container);
    assert.equal(hasMemoryListHeading(page.container), false);
    assert.deepEqual(requests.map(({ path }) => path), ["/memory/memory-1"]);
  } finally {
    await page.cleanup();
  }
});

test("Memory active and archived detail returns notify the app router for a safe global-search return", async () => {
  const returnTo = "/search?q=goal&modules=memory&scope=all";
  const paths = [
    createMemoryDetailLocation("memory-1", returnTo),
    createArchivedMemoryDetailLocation("memory-1", returnTo),
  ];
  for (const path of paths) {
    const { api } = pendingApi();
    const page = await render(path, api);
    try {
      let routeChanges = 0;
      page.window.addEventListener("popstate", () => { routeChanges += 1; });
      const button = [...page.container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent === (path.includes("archivedMemory") ? "返回归档列表" : "返回记忆列表"));
      assert.ok(button);
      await React.act(async () => {
        button.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      });
      assert.equal(`${page.window.location.pathname}${page.window.location.search}`, returnTo);
      assert.equal(routeChanges, 1);
    } finally {
      await page.cleanup();
    }
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

test("Memory list search becomes a refresh-safe returnTo before detail editing", async () => {
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
    const edit = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "编辑");
    assert.ok(edit);
    await React.act(async () => {
      edit.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.ok(
      page.container.querySelector("textarea"),
      "detail edit remains available",
    );
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
    assert.equal(
      [...page.container.querySelectorAll("button")]
        .some((button) => button.textContent === "归档"),
      false,
    );

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
      save.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      await Promise.resolve();
    });

    const updates = requests.filter(({ init }) => init?.method === "PATCH");
    assert.equal(updates.length, 1);
    const update = updates[0];
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

test("Memory dirty create confirmation, retry gate, and stale completion are safe", async () => {
  const first = deferred<unknown>();
  const retry = deferred<unknown>();
  const requests: Request[] = [];
  let createAttempt = 0;
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      if (init?.method === "POST") {
        createAttempt += 1;
        return (createAttempt === 1 ? first.promise : retry.promise) as Promise<T>;
      }
      if (path === "/memory/memory-1") {
        return Promise.resolve({ success: true, data: memory } as T);
      }
      return Promise.resolve(listResponse() as T);
    },
  };
  const page = await render("/memory?q=goal", api);
  try {
    const findButton = (label: string) => [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === label);
    await React.act(async () => {
      findButton("新增记忆")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    const key = page.container.querySelector<HTMLInputElement>('input[placeholder="Key"]');
    const content = page.container.querySelector<HTMLTextAreaElement>('textarea[placeholder="Content"]');
    assert.ok(key && content);
    await React.act(async () => {
      key.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(key), "value")?.set?.call(key, "draft_key");
      const keyChange = new page.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(keyChange, "propertyName", { value: "value" });
      key.dispatchEvent(keyChange);
      content.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content), "value")?.set?.call(content, "draft content");
      const contentChange = new page.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(contentChange, "propertyName", { value: "value" });
      content.dispatchEvent(contentChange);
    });

    let confirmations = 0;
    page.window.confirm = () => {
      confirmations += 1;
      return false;
    };
    await React.act(async () => {
      findButton("取消新增")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(page.window.location.pathname + page.window.location.search, "/memory?q=goal");
    assert.equal(key.value, "draft_key");
    assert.equal(content.value, "draft content");

    const save = findButton("保存");
    assert.ok(save);
    await React.act(async () => {
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter(({ init }) => init?.method === "POST").length, 1);
    await React.act(async () => {
      first.reject(new Error("failed"));
      await first.promise.catch(() => undefined);
    });
    assert.equal(key.value, "draft_key");
    assert.equal(content.value, "draft content");

    const retryButton = findButton("保存");
    assert.ok(retryButton);
    await React.act(async () => {
      retryButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      retryButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter(({ init }) => init?.method === "POST").length, 2);

    page.window.confirm = () => {
      confirmations += 1;
      return true;
    };
    await React.act(async () => {
      page.window.history.pushState(
        null,
        "",
        createMemoryDetailLocation("memory-1", "/memory?q=goal"),
      );
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });
    assert.match(page.window.location.search, /memory=memory-1/);
    assert.equal(page.container.querySelector('input[placeholder="Key"]'), null);
    const unload = new page.window.Event("beforeunload", { cancelable: true });
    assert.equal(page.window.dispatchEvent(unload), true);

    await React.act(async () => {
      retry.resolve({ success: true });
      await retry.promise;
    });
    assert.match(page.window.location.search, /memory=memory-1/);
    assert.equal(confirmations, 2);
  } finally {
    await page.cleanup();
  }
});
