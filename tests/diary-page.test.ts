import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { DiaryPageContent } from "../web/src/pages/DiaryPage.js";
import { createDiaryDetailLocation } from "../web/src/pages/diary-location.js";
import { saveDiaryScrollPosition } from "../web/src/pages/diary-scroll-restoration.js";
import { DEFAULT_SETTINGS } from "../web/src/settings/types.js";

type Request = { path: string; init?: RequestInit };
type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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
    root.render(React.createElement(DiaryPageContent, {
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
    container.querySelector("input[aria-label=\"搜索日记内容\"]"),
    null,
  );
  assert.equal(container.querySelector(".diary-filters"), null);
  assert.equal(container.querySelector(".memory-grid"), null);
}

test("Diary detail refresh starts in detail loading and skips list request", async () => {
  const { api, requests } = pendingApi();
  const page = await render(
    createDiaryDetailLocation(
      "diary-1",
      "/diary?q=trip&tag=Japan",
    ),
    api,
  );
  try {
    assert.match(page.container.textContent ?? "", /正在读取日记/);
    assertNoList(page.container);
    assert.deepEqual(requests.map(({ path }) => path), ["/diary/diary-1"]);
  } finally {
    await page.cleanup();
  }
});

test("Diary list initializes all controls from URL and requests that URL", async () => {
  const { api, requests } = pendingApi();
  const path =
    "/diary?q=trip&tag=Japan&mood=happy&date_from=2026-07-01&date_to=2026-07-07";
  const page = await render(path, api);
  try {
    for (const [label, value] of [
      ["搜索日记内容", "trip"],
      ["按标签筛选", "Japan"],
      ["按心情筛选", "happy"],
      ["开始日期", "2026-07-01"],
      ["结束日期", "2026-07-07"],
    ]) {
      assert.equal(
        page.container.querySelector<HTMLInputElement>(
          `input[aria-label="${label}"]`,
        )?.value,
        value,
      );
    }
    assert.equal(requests[0]?.path, path);
  } finally {
    await page.cleanup();
  }
});

test("Diary default and filtered empty states remain distinct", async () => {
  const api: WebApiClient = {
    async request<T>() {
      return {
        success: true,
        data: { diaries: [], metadata: { count: 0 } },
      } as T;
    },
  };
  for (const [path, expected] of [
    ["/diary", "还没有日记"],
    ["/diary?tag=missing", "没有符合条件的日记"],
  ]) {
    const page = await render(path, api);
    try {
      assert.match(page.container.textContent ?? "", new RegExp(expected));
      if (path.includes("tag=")) {
        assert.match(page.container.textContent ?? "", /清除条件/);
      }
    } finally {
      await page.cleanup();
    }
  }
});

test("Diary latest request failure keeps URL controls and retries without History writes", async () => {
  let attempts = 0;
  const api: WebApiClient = {
    async request<T>() {
      attempts += 1;
      throw new Error("private failure detail");
    },
  };
  const page = await render("/diary?q=trip&tag=Japan", api);
  try {
    const historyLength = page.window.history.length;
    assert.match(page.container.textContent ?? "", /暂时无法读取日记/);
    assert.doesNotMatch(
      page.container.textContent ?? "",
      /private failure detail/,
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"按标签筛选\"]",
      )?.value,
      "Japan",
    );
    const retry = [...page.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "重新加载");
    assert.ok(retry);
    await React.act(async () => {
      retry.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(attempts, 2);
    assert.equal(page.window.history.length, historyLength);
  } finally {
    await page.cleanup();
  }
});

test("Diary popstate aborts the previous list and restores controls without pushing", async () => {
  const { api, requests } = pendingApi();
  const page = await render("/diary?tag=before", api);
  try {
    const initialHistory = page.window.history.length;
    const oldSignal = requests[0]?.init?.signal;
    await React.act(async () => {
      page.window.history.pushState(null, "", "/diary?tag=after&mood=calm");
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });
    assert.equal(oldSignal?.aborted, true);
    assert.equal(page.window.history.length, initialHistory + 1);
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"按标签筛选\"]",
      )?.value,
      "after",
    );
    assert.equal(requests.at(-1)?.path, "/diary?tag=after&mood=calm");
  } finally {
    await page.cleanup();
  }
});

test("Diary refreshed detail explicitly returns to complete safe filters", async () => {
  const { api } = pendingApi();
  const returnTo =
    "/diary?q=trip&tag=Japan&mood=happy&date_from=2026-07-01";
  const page = await render(
    createDiaryDetailLocation("diary-1", returnTo),
    api,
  );
  try {
    const button = [...page.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "返回日记列表");
    assert.ok(button);
    await React.act(async () => {
      button.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      returnTo,
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"搜索日记内容\"]",
      )?.value,
      "trip",
    );
  } finally {
    await page.cleanup();
  }
});

test("Diary in-page return restores scroll only after the filtered list is ready", async () => {
  const returnTo = "/diary?q=trip&tag=Japan";
  const list = deferred<unknown>();
  const requests: Request[] = [];
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      if (path.startsWith("/diary/")) return new Promise<T>(() => {});
      return list.promise as Promise<T>;
    },
  };
  const page = await render(
    createDiaryDetailLocation("diary-1", returnTo),
    api,
  );
  const scrolls: number[] = [];
  page.window.scrollTo = (options?: ScrollToOptions | number) => {
    if (typeof options === "object") scrolls.push(options.top ?? 0);
  };
  saveDiaryScrollPosition(page.window.sessionStorage, returnTo, 720);

  try {
    const button = [...page.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "返回日记列表");
    assert.ok(button);
    await React.act(async () => {
      button.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(requests.at(-1)?.path, "/diary?q=trip&tag=Japan");
    assert.deepEqual(scrolls, []);

    await React.act(async () => {
      list.resolve({
        success: true,
        data: { diaries: [], metadata: { count: 0 } },
      });
      await list.promise;
      await new Promise((resolve) => page.window.setTimeout(resolve, 5));
    });
    assert.deepEqual(scrolls, [720]);
  } finally {
    await page.cleanup();
  }
});

test("Diary browser back restores the matching list scroll after loading", async () => {
  const returnTo = "/diary?mood=happy&date_from=2026-07-01";
  const list = deferred<unknown>();
  const requestedPaths: string[] = [];
  const api: WebApiClient = {
    request<T>(path: string): Promise<T> {
      requestedPaths.push(path);
      if (path.startsWith("/diary/")) return new Promise<T>(() => {});
      return list.promise as Promise<T>;
    },
  };
  const page = await render(
    createDiaryDetailLocation("diary-1", returnTo),
    api,
  );
  const scrolls: number[] = [];
  page.window.scrollTo = (options?: ScrollToOptions | number) => {
    if (typeof options === "object") scrolls.push(options.top ?? 0);
  };
  saveDiaryScrollPosition(page.window.sessionStorage, returnTo, 360);

  try {
    await React.act(async () => {
      page.window.history.pushState(null, "", returnTo);
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });
    assert.deepEqual(scrolls, []);
    await React.act(async () => {
      list.resolve({
        success: true,
        data: { diaries: [], metadata: { count: 0 } },
      });
      await list.promise;
      await new Promise((resolve) => page.window.setTimeout(resolve, 5));
    });
    assert.deepEqual(scrolls, [360]);
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      returnTo,
    );
    assert.deepEqual(requestedPaths, [
      "/diary/diary-1",
      "/diary?mood=happy&date_from=2026-07-01",
    ]);
  } finally {
    await page.cleanup();
  }
});
