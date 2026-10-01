import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { DiaryPageContent } from "../web/src/pages/DiaryPage.js";
import {
  createArchivedDiaryDetailLocation,
  createDiaryArchiveLocation,
  createDiaryDetailLocation,
} from "../web/src/pages/diary-location.js";
import { saveDiaryScrollPosition } from "../web/src/pages/diary-scroll-restoration.js";

type Request = { path: string; init?: RequestInit };
type Deferred<T> = {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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
    root.render(React.createElement(DiaryPageContent, {
      api,
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

const diary = {
  id: "diary-1",
  title: "Archived diary",
  content: "Full archived diary content",
  date: "2026-07-29",
  tags: ["archive"],
  mood: "calm",
  author: "L",
  created_at: "2026-07-29T01:00:00.000Z",
  updated_at: "2026-07-29T02:00:00.000Z",
};

test("Dashboard quick-create intent opens Diary form and focuses title once", async () => {
  const page = await render("/diary", pendingApi().api, { quickCreate: "diary", preserved: true });
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const title = page.container.querySelector<HTMLInputElement>('input[aria-label="日记标题"]');
    assert.ok(title);
    assert.equal(page.window.history.state.quickCreate, undefined);
    assert.equal(page.window.history.state.preserved, true);
    assert.equal(page.window.document.activeElement, title);
  } finally {
    await page.cleanup();
  }
});

test("Diary archive safely consumes quick-create without opening a hidden form", async () => {
  const page = await render(createDiaryArchiveLocation("/diary"), pendingApi().api, { quickCreate: "diary" });
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(page.container.querySelector('input[aria-label="日记标题"]'), null);
    assert.equal(page.window.history.state.quickCreate, undefined);
  } finally {
    await page.cleanup();
  }
});

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
    assert.match(page.container.textContent ?? "", /Reading\.\.\./);
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
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        'input[aria-label="搜索日记内容"]',
      )?.value,
      "trip",
    );
    for (const label of ["按标签筛选", "按心情筛选", "按日期筛选"]) {
      assert.equal(
        page.container.querySelector<HTMLButtonElement>(
          `button[aria-label="${label}"]`,
        )?.getAttribute("aria-pressed"),
        "true",
      );
    }
    assert.equal(requests[0]?.path, path);
  } finally {
    await page.cleanup();
  }
});

test("Diary normal list places archive and create actions in the page header", async () => {
  const { api, requests } = pendingApi();
  const page = await render("/diary", api);
  try {
    const archiveButtons = [...page.container.querySelectorAll("button[aria-label=\"查看归档\"]")];
    const createButtons = [...page.container.querySelectorAll("button[aria-label=\"新增日记\"]")];
    assert.equal(archiveButtons.length, 1);
    assert.equal(createButtons.length, 1);
    assert.equal(
      archiveButtons[0]?.parentElement?.className,
      "memory-page-tools diary-page-tools",
    );
    assert.equal(
      createButtons[0]?.parentElement?.className,
      "memory-page-tools diary-page-tools",
    );
    assert.deepEqual(
      [...page.container.querySelectorAll(".diary-page-tools button")]
        .map((button) => button.getAttribute("aria-label")),
      ["按日期筛选", "按心情筛选", "按标签筛选", "搜索日记", "查看归档", "新增日记"],
    );
    assert.equal(requests[0]?.path, "/diary");
  } finally {
    await page.cleanup();
  }
});

test("Diary normal and archived lists use the same date-order summary", async () => {
  const api: WebApiClient = {
    async request<T>(path: string) {
      if (path === "/diary/archived") {
        return {
          success: true,
          data: { diaries: [diary], metadata: { count: 1 } },
        } as T;
      }
      return {
        success: true,
        data: { diaries: [diary], metadata: { count: 1 } },
      } as T;
    },
  };
  for (const path of [
    "/diary",
    createDiaryArchiveLocation("/diary"),
  ]) {
    const page = await render(path, api);
    try {
      assert.match(
        page.container.textContent ?? "",
        path.includes("view=archived") ? /Archive1篇日记/ : /Diary1篇日记/,
      );
    } finally {
      await page.cleanup();
    }
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
    assert.match(page.container.textContent ?? "", /Unable to read diary entries\./);
    assert.doesNotMatch(
      page.container.textContent ?? "",
      /private failure detail/,
    );
    assert.equal(
      page.container.querySelector<HTMLButtonElement>(
        "button[aria-label=\"按标签筛选\"]",
      )?.getAttribute("aria-pressed"),
      "true",
    );
    const retry = [...page.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "Retry");
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
      page.container.querySelector<HTMLButtonElement>(
        "button[aria-label=\"按标签筛选\"]",
      )?.getAttribute("aria-pressed"),
      "true",
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
    const button = page.container.querySelector<HTMLButtonElement>(
      "button.paper-detail-veil",
    );
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
    assert.ok(page.container.querySelector(".diary-page-search"));
  } finally {
    await page.cleanup();
  }
});

test("Diary active and archived detail returns notify the app router for a safe global-search return", async () => {
  const returnTo = "/search?q=trip&modules=diary&mode=phrase";
  const paths = [
    createDiaryDetailLocation("diary-1", returnTo),
    createArchivedDiaryDetailLocation("diary-1", returnTo),
  ];
  for (const path of paths) {
    const { api } = pendingApi();
    const page = await render(path, api);
    try {
      let routeChanges = 0;
      page.window.addEventListener("popstate", () => { routeChanges += 1; });
      const button = page.container.querySelector<HTMLButtonElement>(
        "button.paper-detail-veil",
      );
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

test("Diary direct Universe detail returns notify the app router for active and archived close", async () => {
  const returnTo = "/universe?node=node-1";
  const paths = [
    createDiaryDetailLocation("diary-1", returnTo),
    createArchivedDiaryDetailLocation("diary-1", returnTo),
  ];
  for (const path of paths) {
    const { api } = pendingApi();
    const page = await render(path, api);
    try {
      let routeChanges = 0;
      page.window.addEventListener("popstate", () => { routeChanges += 1; });
    const button = page.container.querySelector<HTMLButtonElement>(
      "button.paper-detail-veil",
    );
      assert.ok(button);
      await React.act(async () => { button.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true })); });
      assert.equal(`${page.window.location.pathname}${page.window.location.search}`, returnTo);
      assert.equal(routeChanges, 1);
    } finally {
      await page.cleanup();
    }
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
    const button = page.container.querySelector<HTMLButtonElement>(
      "button.paper-detail-veil",
    );
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

test("Diary archive list is read-only and opens full archived detail", async () => {
  const paths: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string) {
      paths.push(path);
      if (path === "/diary/archived") {
        return {
          success: true,
          data: { diaries: [diary], metadata: { count: 1 } },
        } as T;
      }
      return { success: true, data: diary } as T;
    },
  };
  const archiveUrl = createDiaryArchiveLocation(
    "/diary?q=goal&tag=MCP&mood=calm",
  );
  const page = await render(archiveUrl, api);
  try {
    assert.match(page.container.textContent ?? "", /Archive1篇日记/);
    assert.doesNotMatch(
      page.container.textContent ?? "",
      /编辑|再次归档|永久删除/,
    );
    const open = page.container.querySelector<HTMLButtonElement>(
      '[data-diary-id="diary-1"]',
    );
    assert.ok(open);
    await React.act(async () => {
      open.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(paths.at(-1), "/diary/archived/diary-1");
    assert.match(
      page.container.textContent ?? "",
      /Full archived diary content/,
    );
    assert.match(page.container.textContent ?? "", /恢复/);
    assert.doesNotMatch(page.container.textContent ?? "", /编辑|归档中/);
  } finally {
    await page.cleanup();
  }
});

test("Diary archived direct refresh requests only archived detail", async () => {
  const { api, requests } = pendingApi();
  const archiveUrl = createDiaryArchiveLocation("/diary?q=goal");
  const page = await render(
    createArchivedDiaryDetailLocation("diary-1", archiveUrl),
    api,
  );
  try {
    assert.match(page.container.textContent ?? "", /Reading\.\.\./);
    assertNoList(page.container);
    assert.deepEqual(
      requests.map(({ path }) => path),
      ["/diary/archived/diary-1"],
    );
  } finally {
    await page.cleanup();
  }
});

test("Diary desktop permanent-delete confirmation replaces regular actions and blocks archive return while pending", async () => {
  const deletion = deferred<unknown>();
  const requests: Request[] = [];
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/diary/archived/diary-1") {
        return Promise.resolve({ success: true, data: diary }) as Promise<T>;
      }
      if (init?.method === "DELETE") return deletion.promise as Promise<T>;
      throw new Error(`Unexpected request: ${path}`);
    },
  };
  const page = await render(
    createArchivedDiaryDetailLocation("diary-1", "/diary/archived"),
    api,
  );
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const detail = page.container.querySelector("#diary-archive-detail-paper");
    assert.ok(detail);
    const deleteButton = [...detail.querySelectorAll("button")]
      .find((button) => button.textContent === "删除");
    assert.ok(deleteButton);
    await React.act(async () => {
      deleteButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter((request) => request.init?.method === "DELETE").length, 0);
    assert.deepEqual(
      [...detail.querySelectorAll("button")].map((button) => button.textContent),
      ["取消", "确认永久删除"],
    );

    const confirm = [...detail.querySelectorAll("button")]
      .find((button) => button.textContent === "确认永久删除");
    assert.ok(confirm);
    await React.act(async () => {
      confirm.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter((request) => request.init?.method === "DELETE").length, 1);
    const close = page.container.querySelector<HTMLButtonElement>("button.paper-detail-veil");
    assert.ok(close);
    await React.act(async () => close.click());
    assert.ok(page.container.querySelector("#diary-archive-detail-paper"));

    deletion.reject(new Error("delete failed"));
    await React.act(async () => {
      await deletion.promise.catch(() => undefined);
    });
    assert.match(page.container.textContent ?? "", /永久删除日记失败/);
    assert.match(page.container.textContent ?? "", /确认永久删除/);
  } finally {
    await page.cleanup();
  }
});

test("Diary active detail archives once with archive wording", async () => {
  const calls: Request[] = [];
  const archive = deferred<unknown>();
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (init?.method === "DELETE") return archive.promise as Promise<T>;
      if (path === "/diary/diary-1") {
        return Promise.resolve({ success: true, data: diary } as T);
      }
      return new Promise<T>(() => {});
    },
  };
  const page = await render(
    createDiaryDetailLocation("diary-1", "/diary?q=goal"),
    api,
  );
  page.window.confirm = () => true;
  try {
    const button = [...page.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "归档");
    assert.ok(button);
    assert.doesNotMatch(page.container.textContent ?? "", /删除/);
    await React.act(async () => {
      button.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      button.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(
      calls.filter(({ init }) => init?.method === "DELETE").length,
      1,
    );
    assert.equal(
      calls.find(({ init }) => init?.method === "DELETE")?.init?.body,
      undefined,
    );
    assert.match(page.container.textContent ?? "", /归档中/);
    await React.act(async () => {
      archive.resolve({ success: true });
      await archive.promise;
    });
  } finally {
    await page.cleanup();
  }
});

test("Diary C edit starts at C, author changes are dirty, and cancel restores C", async () => {
  const cDiary = { ...diary, id: "diary-c", author: "C" as const };
  const requests: Request[] = [];
  const page = await render(createDiaryDetailLocation("diary-c", "/diary"), {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/diary/diary-c") return { success: true, data: cDiary } as T;
      throw new Error(`Unexpected request: ${path}`);
    },
  });
  try {
    await React.act(async () => { await Promise.resolve(); });
    assert.equal(page.container.querySelector(".paper-author-signature")?.textContent, "C");

    const edit = [...page.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "编辑");
    assert.ok(edit);
    await React.act(async () => edit.click());
    const trigger = page.container.querySelector<HTMLButtonElement>(".paper-author-signature-trigger");
    assert.ok(trigger);
    assert.equal(trigger.textContent, "C");

    await React.act(async () => trigger.click());
    const g = page.container.querySelector<HTMLButtonElement>('[role="menuitemradio"][data-author="G"]');
    assert.ok(g);
    await React.act(async () => g.click());
    assert.equal(trigger.textContent, "G");

    let confirmations = 0;
    page.window.confirm = () => {
      confirmations += 1;
      return false;
    };
    const cancel = [...page.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "取消");
    assert.ok(cancel);
    await React.act(async () => cancel.click());
    assert.equal(confirmations, 1);
    assert.equal(page.container.querySelector(".paper-author-signature-trigger")?.textContent, "G");
    assert.equal(requests.some(({ init }) => init?.method === "PATCH"), false);

    page.window.confirm = () => true;
    await React.act(async () => cancel.click());
    assert.equal(page.container.querySelector(".paper-author-signature")?.textContent, "C");
    assert.equal(page.container.querySelector(".paper-author-signature-trigger"), null);
  } finally {
    await page.cleanup();
  }
});

test("Diary restore is single-flight and returns to exact active filters", async () => {
  const calls: Request[] = [];
  const restore = deferred<unknown>();
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (path.endsWith("/restore")) return restore.promise as Promise<T>;
      if (path === "/diary/archived/diary-1") {
        return Promise.resolve({ success: true, data: diary } as T);
      }
      return new Promise<T>(() => {});
    },
  };
  const activeUrl = "/diary?q=goal&tag=MCP&mood=calm";
  const archiveUrl = createDiaryArchiveLocation(activeUrl);
  const page = await render(
    createArchivedDiaryDetailLocation("diary-1", archiveUrl),
    api,
  );
  try {
    const button = [...page.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "恢复");
    assert.ok(button);
    await React.act(async () => {
      button.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
      button.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(
      calls.filter(({ path }) => path.endsWith("/restore")).length,
      1,
    );
    assert.equal(
      calls.find(({ path }) => path.endsWith("/restore"))?.init?.body,
      undefined,
    );
    await React.act(async () => {
      restore.resolve({ success: true });
      await restore.promise;
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      activeUrl,
    );
  } finally {
    await page.cleanup();
  }
});

test("Diary browser history restores archive list then exact filtered active list", async () => {
  const requests: string[] = [];
  const api: WebApiClient = {
    async request<T>(path: string) {
      requests.push(path);
      if (path === "/diary/archived") {
        return {
          success: true,
          data: { diaries: [diary], metadata: { count: 1 } },
        } as T;
      }
      if (path === "/diary/archived/diary-1") {
        return { success: true, data: diary } as T;
      }
      return {
        success: true,
        data: { diaries: [], metadata: { count: 0 } },
      } as T;
    },
  };
  const activeUrl =
    "/diary?q=goal&tag=MCP&mood=calm&date_from=2026-07-01";
  const page = await render(activeUrl, api);
  try {
    const archive = page.container.querySelector<HTMLButtonElement>(
      'button[aria-label="查看归档"]',
    );
    assert.ok(archive);
    await React.act(async () => {
      archive.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    const archiveUrl =
      `${page.window.location.pathname}${page.window.location.search}`;
    const open = page.container.querySelector<HTMLButtonElement>(
      '[data-diary-id="diary-1"]',
    );
    assert.ok(open);
    await React.act(async () => {
      open.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });

    await React.act(async () => {
      page.window.history.pushState(null, "", archiveUrl);
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });
    assert.equal(requests.at(-1), "/diary/archived");

    await React.act(async () => {
      page.window.history.pushState(null, "", activeUrl);
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });
    assert.equal(requests.at(-1), activeUrl);
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      activeUrl,
    );
    assert.equal(
      requests.some((path) => path === "/diary/diary-1"),
      false,
    );
  } finally {
    await page.cleanup();
  }
});

test("Diary dirty create preserves on cancel, retries once, and ignores stale success", async () => {
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
      if (path === "/diary/diary-1") {
        return Promise.resolve({ success: true, data: diary } as T);
      }
      return Promise.resolve({
        success: true,
        data: { diaries: [diary], metadata: { count: 1 } },
      } as T);
    },
  };
  const page = await render("/diary?q=goal", api);
  try {
    const findButton = (label: string) => label === "新增日记"
      ? page.container.querySelector<HTMLButtonElement>('button[aria-label="新增日记"]')
      : [...page.container.querySelectorAll("button")].find((button) => button.textContent === label);
    await React.act(async () => {
      findButton("新增日记")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    const title = page.container.querySelector<HTMLInputElement>('input[aria-label="日记标题"]');
    const content = page.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="日记正文"]');
    assert.ok(title && content);
    await React.act(async () => {
      title.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(title), "value")?.set?.call(title, "draft diary");
      const titleChange = new page.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(titleChange, "propertyName", { value: "value" });
      title.dispatchEvent(titleChange);
      content.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(content), "value")?.set?.call(content, "draft diary content");
      const contentChange = new page.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(contentChange, "propertyName", { value: "value" });
      content.dispatchEvent(contentChange);
    });

    const authorTrigger = page.container.querySelector<HTMLButtonElement>(".paper-author-signature-trigger");
    assert.ok(authorTrigger);
    await React.act(async () => authorTrigger.click());
    const authorC = page.container.querySelector<HTMLButtonElement>('[role="menuitemradio"][data-author="C"]');
    assert.ok(authorC);
    await React.act(async () => authorC.click());

    let confirmations = 0;
    page.window.confirm = () => {
      confirmations += 1;
      return false;
    };
    await React.act(async () => {
      page.container.querySelector<HTMLButtonElement>('#diary-create-paper button.memory-paper-control')?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(page.window.location.pathname + page.window.location.search, "/diary?q=goal");
    assert.equal(title.value, "draft diary");
    assert.equal(content.value, "draft diary content");

    const save = [...page.container.querySelectorAll("#diary-create-paper button.memory-paper-control")]
      .find((button) => button.textContent === "保存");
    assert.ok(save);
    await React.act(async () => {
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter(({ init }) => init?.method === "POST").length, 1);
    const createRequest = requests.find(({ init }) => init?.method === "POST");
    assert.equal(JSON.parse(String(createRequest?.init?.body)).author, "C");
    await React.act(async () => {
      first.reject(new Error("failed"));
      await first.promise.catch(() => undefined);
    });
    assert.equal(title.value, "draft diary");
    assert.equal(content.value, "draft diary content");

    const retryButton = [...page.container.querySelectorAll("#diary-create-paper button.memory-paper-control")]
      .find((button) => button.textContent === "保存");
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
        createDiaryDetailLocation("diary-1", "/diary?q=goal"),
      );
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });
    assert.match(page.window.location.search, /diary=diary-1/);
    assert.equal(page.container.querySelector('input[aria-label="日记标题"]'), null);
    assert.equal(page.window.dispatchEvent(new page.window.Event("beforeunload", { cancelable: true })), true);
    await React.act(async () => {
      retry.resolve({ success: true, data: diary });
      await retry.promise;
    });
    assert.match(page.window.location.search, /diary=diary-1/);
    assert.equal(confirmations, 2);
  } finally {
    await page.cleanup();
  }
});

test("Diary legacy-null edit requires selecting an author before PATCH", async () => {
  const requests: Request[] = [];
  const legacyDiary = { ...diary, author: null };
  const page = await render(createDiaryDetailLocation("diary-1", "/diary"), {
    async request<T>(path: string, init?: RequestInit) {
      requests.push({ path, init });
      if (path === "/diary/diary-1") return { success: true, data: legacyDiary } as T;
      if (init?.method === "PATCH") return { success: true, data: { ...legacyDiary, author: "G" } } as T;
      return { success: true, data: { diaries: [legacyDiary], metadata: { count: 1 } } } as T;
    },
  });
  try {
    const edit = [...page.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "编辑");
    assert.ok(edit);
    await React.act(async () => edit.click());
    const save = [...page.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "保存");
    assert.ok(save);
    await React.act(async () => save.click());
    assert.equal(requests.some(({ init }) => init?.method === "PATCH"), false);

    const trigger = page.container.querySelector<HTMLButtonElement>(".paper-author-signature-trigger");
    assert.ok(trigger);
    await React.act(async () => trigger.click());
    const g = page.container.querySelector<HTMLButtonElement>('[role="menuitemradio"][data-author="G"]');
    assert.ok(g);
    await React.act(async () => g.click());
    await React.act(async () => save.click());
    const patch = requests.find(({ init }) => init?.method === "PATCH");
    assert.ok(patch);
    assert.equal(JSON.parse(String(patch.init?.body)).author, "G");
  } finally {
    await page.cleanup();
  }
});

test("Diary dirty edit cancellation and update retry are page-level single-flight", async () => {
  const first = deferred<unknown>();
  const retry = deferred<unknown>();
  let updateAttempt = 0;
  const requests: Request[] = [];
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      if (init?.method === "PATCH") {
        updateAttempt += 1;
        return (updateAttempt === 1 ? first.promise : retry.promise) as Promise<T>;
      }
      return Promise.resolve({ success: true, data: diary } as T);
    },
  };
  const page = await render(createDiaryDetailLocation("diary-1", "/diary?q=goal"), api);
  try {
    const findButton = (label: string) => [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === label);
    const startEdit = async () => {
      await React.act(async () => {
        findButton("编辑")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      });
    };
    await startEdit();
    let title = page.container.querySelector<HTMLInputElement>('input[aria-label="日记标题"]');
    assert.ok(title);
    await React.act(async () => {
      title.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(title), "value")?.set?.call(title, "changed diary");
      const change = new page.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(change, "propertyName", { value: "value" });
      title.dispatchEvent(change);
    });
    page.window.confirm = () => false;
    await React.act(async () => {
      findButton("取消")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(title.value, "changed diary");
    assert.ok(page.container.querySelector('input[aria-label="日记标题"]'));
    page.window.confirm = () => true;
    await React.act(async () => {
      findButton("取消")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(page.container.querySelector('input[aria-label="日记标题"]'), null);
    assert.equal(page.window.dispatchEvent(new page.window.Event("beforeunload", { cancelable: true })), true);

    await startEdit();
    title = page.container.querySelector<HTMLInputElement>('input[aria-label="日记标题"]');
    assert.ok(title);
    await React.act(async () => {
      title.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(title), "value")?.set?.call(title, "retry diary");
      const change = new page.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(change, "propertyName", { value: "value" });
      title.dispatchEvent(change);
    });
    const save = findButton("保存");
    assert.ok(save);
    await React.act(async () => {
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter(({ init }) => init?.method === "PATCH").length, 1);
    await React.act(async () => {
      first.reject(new Error("failed"));
      await first.promise.catch(() => undefined);
    });
    assert.equal(title.value, "retry diary");
    const retryButton = findButton("保存");
    assert.ok(retryButton);
    await React.act(async () => {
      retryButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      retryButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter(({ init }) => init?.method === "PATCH").length, 2);
    await React.act(async () => {
      retry.resolve({ success: true, data: { ...diary, title: "retry diary" } });
      await retry.promise;
    });
  } finally {
    await page.cleanup();
  }
});
