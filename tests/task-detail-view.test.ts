import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  TaskPageContent,
} from "../web/src/pages/TaskPage.js";
import {
  createArchivedTaskDetailLocation,
  createTaskArchiveLocation,
  createTaskDetailLocation,
} from "../web/src/pages/task-location.js";
import { readTaskFilterHistorySnapshot } from "../web/src/pages/task-filter-history.js";
import { buildTaskListRequest } from "../web/src/pages/task-list-request.js";

type RequestRecord = {
  init: RequestInit | undefined;
  path: string;
};

type Deferred<T> = {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T): void;
};

const TASK_ID = "task-123";
const FILTERED_TASK_LIST =
  "/task?q=abc&status=pending&priority=high&tag=work&due=custom&due_from=2026-07-29&due_to=2026-08-05";
const FILTERED_TASK_REQUEST = buildTaskListRequest(
  readTaskFilterHistorySnapshot(
    new URL(FILTERED_TASK_LIST, "https://leilei-os.test").search,
  ),
).url;
const TASK_RESPONSE = {
  success: true as const,
  data: {
    id: TASK_ID,
    title: "详情任务",
    description: "只应在详情请求完成后显示。",
    status: "pending" as const,
    priority: "normal" as const,
    due_time: "2026-07-27T08:00:00.000Z",
    timezone: "Asia/Shanghai",
    time_bucket: "later" as const,
    tags: ["detail"],
    created_at: "2026-07-26T00:00:00.000Z",
    updated_at: "2026-07-26T00:00:00.000Z",
    completed_at: null,
    allowed_actions: ["start", "cancel"] as const,
    author: "L" as const,
  },
};

test("Dashboard quick-create intent opens Task form and focuses title once", async () => {
  const page = await renderTaskPage("/task", createApi(async () => new Promise<never>(() => {})).api, { quickCreate: "task", preserved: true });
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const title = page.container.querySelector<HTMLInputElement>('input[placeholder="任务标题"]');
    assert.ok(title);
    assert.equal(
      page.container.querySelector<HTMLButtonElement>(".paper-author-signature-trigger")?.textContent,
      "—",
    );
    assert.equal(page.window.history.state.quickCreate, undefined);
    assert.equal(page.window.history.state.preserved, true);
    assert.equal(page.window.document.activeElement, title);
  } finally {
    await page.cleanup();
  }
});

test("Task details display the stored author or legacy unknown marker without exposing an edit control", async () => {
  for (const [author, expected] of [["G", "G"], [null, "—"]] as const) {
    const response = { ...TASK_RESPONSE, data: { ...TASK_RESPONSE.data, author } };
    const page = await renderTaskPage(
      createTaskDetailLocation(TASK_ID, "/task"),
      createApi(async () => response).api,
    );
    try {
      await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      assert.equal(
        page.container.querySelector(".paper-author-signature")?.textContent,
        expected,
      );
      assert.equal(page.container.querySelector(".paper-author-signature-trigger"), null);
    } finally {
      await page.cleanup();
    }
  }
});

test("Task detail safely consumes quick-create without opening a hidden form", async () => {
  const page = await renderTaskPage(createTaskDetailLocation(TASK_ID, "/task"), createApi(async () => new Promise<never>(() => {})).api, { quickCreate: "task" });
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(page.container.querySelector('input[placeholder="任务标题"]'), null);
    assert.equal(page.window.history.state.quickCreate, undefined);
  } finally {
    await page.cleanup();
  }
});

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createApi(
  handler: (
    path: string,
    init: RequestInit | undefined,
  ) => Promise<unknown>,
): { api: WebApiClient; requests: RequestRecord[] } {
  const requests: RequestRecord[] = [];
  return {
    requests,
    api: {
      request<T>(path: string, init?: RequestInit): Promise<T> {
        requests.push({ path, init });
        return handler(path, init) as Promise<T>;
      },
    },
  };
}

async function renderTaskPage(
  path: string,
  api: WebApiClient,
  historyState?: unknown,
  mobile = false,
) {
  const dom = new JSDOM("<main id=\"root\"></main>", {
    url: `https://leilei-os.test${path}`,
  });
  const previousGlobals = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const installGlobal = (name: PropertyKey, value: unknown) => {
    previousGlobals.set(
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    );
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    });
  };

  installGlobal("window", dom.window);
  installGlobal("document", dom.window.document);
  installGlobal("navigator", dom.window.navigator);
  installGlobal("HTMLElement", dom.window.HTMLElement);
  installGlobal("HTMLInputElement", dom.window.HTMLInputElement);
  installGlobal("HTMLTextAreaElement", dom.window.HTMLTextAreaElement);
  installGlobal("InputEvent", dom.window.InputEvent);
  installGlobal("Node", dom.window.Node);
  installGlobal("Event", dom.window.Event);
  installGlobal("MouseEvent", dom.window.MouseEvent);
  installGlobal("PopStateEvent", dom.window.PopStateEvent);
  installGlobal("React", React);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.matchMedia = () => ({
    matches: mobile,
    media: "(max-width: 760px)",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });
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
  const scrollCalls: ScrollToOptions[] = [];
  Object.defineProperty(dom.window, "scrollY", {
    configurable: true,
    value: 0,
  });
  dom.window.scrollTo = (options?: ScrollToOptions | number, y?: number) => {
    if (typeof options === "number") {
      scrollCalls.push({ top: y ?? 0, left: options });
      Object.defineProperty(dom.window, "scrollY", { configurable: true, value: y ?? 0 });
      return;
    }
    scrollCalls.push(options ?? {});
    Object.defineProperty(dom.window, "scrollY", {
      configurable: true,
      value: options?.top ?? dom.window.scrollY,
    });
  };
  dom.window.requestAnimationFrame = (callback) =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  installGlobal(
    "requestAnimationFrame",
    dom.window.requestAnimationFrame.bind(dom.window),
  );

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  if (historyState !== undefined) dom.window.history.replaceState(historyState, "", path);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(TaskPageContent, {
      api,
    }));
  });

  return {
    container,
    window: dom.window,
    scrollCalls,
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
    },
  };
}

function assertNoListView(container: Element): void {
  assert.equal(
    container.querySelector("input[aria-label=\"搜索任务\"]"),
    null,
  );
  assert.equal(container.querySelector(".task-filters"), null);
  assert.equal(container.querySelector(".memory-grid"), null);
  assert.doesNotMatch(container.textContent ?? "", /搜索与筛选/);
}

test("Task filter heading appears in list mode and not detail mode", async () => {
  const list = await renderTaskPage(
    "/task",
    createApi(() => new Promise(() => {})).api,
  );
  try {
    assert.match(list.container.textContent ?? "", /搜索与筛选/);
  } finally {
    await list.cleanup();
  }

  const detail = await renderTaskPage(
    `/task?task=${TASK_ID}`,
    createApi(() => new Promise(() => {})).api,
  );
  try {
    assertNoListView(detail.container);
  } finally {
    await detail.cleanup();
  }
});

test("normal Task list keeps header action order, exact summary, and read-only cards", async () => {
  const { api } = createApi(async () => ({
    success: true,
    data: { tasks: [TASK_RESPONSE.data], metadata: { count: 1 } },
  }));
  const page = await renderTaskPage("/task", api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const headerActions = page.container.querySelector(".page-header-actions");
    assert.ok(headerActions);
    assert.deepEqual(
      [...headerActions.querySelectorAll("button")].map((button) => button.textContent),
      ["查看归档", "新建任务"],
    );
    assert.match(page.container.textContent ?? "", /共 1 项，按截止时间排列。/);
    const cards = page.container.querySelector(".memory-grid");
    assert.ok(cards);
    assert.equal(
      [...cards.querySelectorAll("button")].some((button) => button.textContent === "归档"),
      false,
    );
    const mobilePage = await renderTaskPage("/task", api, undefined, true);
    try {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const taskMetadata = mobilePage.container.querySelector(
        ".task-row .memory-row-meta",
      );
      assert.ok(taskMetadata);
      assert.equal(taskMetadata.children.length, 2);
    } finally {
      await mobilePage.cleanup();
    }
  } finally {
    await page.cleanup();
  }
});

test("active terminal Task list exposes one in-place reopen action", async () => {
  const terminal = {
    ...TASK_RESPONSE.data,
    status: "cancelled" as const,
    completed_at: null,
    allowed_actions: ["reopen"] as const,
  };
  const { api, requests } = createApi(async (path, init) => {
    if (path === "/task/task-123/reopen") {
      return { success: true, data: { ...terminal, status: "pending", allowed_actions: ["start", "cancel"] } };
    }
    return { success: true, data: { tasks: [terminal], metadata: { count: 1 } } };
  });
  const page = await renderTaskPage("/task?status=cancelled", api);
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    page.window.history.replaceState({ preserved: true }, "", "/task?status=cancelled");
    Object.defineProperty(page.window, "scrollY", { configurable: true, value: 640 });
    const buttons = [...page.container.querySelectorAll("button")].filter((button) => button.textContent === "恢复任务");
    assert.equal(buttons.length, 1);
    await React.act(async () => { buttons[0]!.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true })); });
    assert.equal(requests.filter(({ path, init }) => path === "/task/task-123/reopen" && init?.method === "POST").length, 1);
    assert.equal(page.container.querySelector("[aria-label=\"任务列表加载中\"]"), null);
    assert.equal(page.container.textContent?.includes("详情任务"), false);
    assert.equal(page.window.location.pathname + page.window.location.search, "/task?status=cancelled");
    assert.deepEqual(page.window.history.state, { preserved: true });
    assert.deepEqual(page.scrollCalls.at(-1), { top: 640, left: 0, behavior: "auto" });
  } finally {
    await page.cleanup();
  }
});

test("completed status-filtered reopen removes the task without entering loading", async () => {
  const terminal = {
    ...TASK_RESPONSE.data,
    status: "completed" as const,
    completed_at: "2026-07-29T04:00:00.000Z",
    allowed_actions: ["reopen"] as const,
  };
  const { api, requests } = createApi(async (path) => {
    if (path === "/task/task-123/reopen") {
      return {
        success: true,
        data: { ...terminal, status: "in_progress", completed_at: null, allowed_actions: ["complete", "cancel"] },
      };
    }
    return { success: true, data: { tasks: [terminal], metadata: { count: 1 } } };
  });
  const page = await renderTaskPage("/task?status=completed", api);
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const button = [...page.container.querySelectorAll("button")].find((candidate) => candidate.textContent === "恢复任务");
    assert.ok(button);
    await React.act(async () => { button.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true })); });
    assert.equal(requests.filter(({ path, init }) => path === "/task/task-123/reopen" && init?.method === "POST").length, 1);
    assert.match(page.container.textContent ?? "", /还没有任务|没有符合条件的任务/);
    assert.equal(page.container.querySelector("[aria-label=\"任务列表加载中\"]"), null);
  } finally {
    await page.cleanup();
  }
});

test("unfiltered reopen replaces the card in place and preserves count", async () => {
  const terminal = { ...TASK_RESPONSE.data, status: "cancelled" as const, allowed_actions: ["reopen"] as const };
  const reopened = { ...terminal, status: "pending" as const, allowed_actions: ["start", "cancel"] as const };
  const { api, requests } = createApi(async (path) => {
    if (path === "/task/task-123/reopen") return { success: true, data: reopened };
    return { success: true, data: { tasks: [terminal], metadata: { count: 1 } } };
  });
  const page = await renderTaskPage("/task", api);
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const card = page.container.querySelector(".memory-card");
    assert.ok(card);
    const button = [...card.querySelectorAll("button")].find((candidate) => candidate.textContent === "恢复任务");
    assert.ok(button);
    await React.act(async () => { button.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true })); });
    assert.equal(requests.filter(({ path, init }) => path === "/task/task-123/reopen" && init?.method === "POST").length, 1);
    assert.match(card.textContent ?? "", /待处理/);
    assert.equal([...card.querySelectorAll("button")].some((candidate) => candidate.textContent === "恢复任务"), false);
    assert.match(page.container.textContent ?? "", /共 1 项/);
  } finally {
    await page.cleanup();
  }
});

test("list reopen failure preserves the card and allows exactly one retry", async () => {
  let attempt = 0;
  const terminal = { ...TASK_RESPONSE.data, status: "cancelled" as const, allowed_actions: ["reopen"] as const };
  const reopened = { ...terminal, status: "pending" as const, allowed_actions: ["start", "cancel"] as const };
  const { api, requests } = createApi(async (path) => {
    if (path === "/task/task-123/reopen") {
      attempt += 1;
      if (attempt === 1) throw new Error("failed");
      return { success: true, data: reopened };
    }
    return { success: true, data: { tasks: [terminal], metadata: { count: 1 } } };
  });
  const page = await renderTaskPage("/task", api);
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const findButton = () => [...page.container.querySelectorAll("button")].find((candidate) => candidate.textContent === "恢复任务");
    const first = findButton();
    assert.ok(first);
    await React.act(async () => { first.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true })); });
    assert.match(page.container.textContent ?? "", /恢复任务失败/);
    const retry = findButton();
    assert.ok(retry);
    assert.equal(retry.disabled, false);
    await React.act(async () => { retry.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true })); });
    assert.equal(requests.filter(({ path, init }) => path === "/task/task-123/reopen" && init?.method === "POST").length, 2);
    assert.match(page.container.textContent ?? "", /待处理/);
  } finally {
    await page.cleanup();
  }
});

test("direct detail load renders a detail placeholder first and skips the list request", async () => {
  const detail = deferred<unknown>();
  const { api, requests } = createApi(() => detail.promise);
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);

  try {
    assert.ok(
      page.container.querySelector(
        "[aria-label=\"任务详情加载中\"]",
      ),
    );
    assertNoListView(page.container);
    assert.deepEqual(
      requests.map((request) => request.path),
      [`/task/${TASK_ID}`],
    );
  } finally {
    await page.cleanup();
  }
});

test("Task active and archived detail returns notify the app router for a safe global-search return", async () => {
  const returnTo = "/search?q=plan&modules=task&scope=all";
  const paths = [
    createTaskDetailLocation(TASK_ID, returnTo),
    createArchivedTaskDetailLocation(TASK_ID, returnTo),
  ];
  for (const path of paths) {
    const { api } = createApi(() => new Promise(() => {}));
    const page = await renderTaskPage(path, api);
    try {
      let routeChanges = 0;
      page.window.addEventListener("popstate", () => { routeChanges += 1; });
      const button = [...page.container.querySelectorAll("button")]
        .find((candidate) => candidate.textContent === (path.includes("archived=1") ? "返回归档列表" : "返回任务列表"));
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

test("detail success replaces the placeholder with the requested task", async () => {
  const detail = deferred<unknown>();
  const { api } = createApi(() => detail.promise);
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);

  try {
    await React.act(async () => {
      detail.resolve(TASK_RESPONSE);
      await detail.promise;
    });
    assert.match(page.container.textContent ?? "", /详情任务/);
    assertNoListView(page.container);
  } finally {
    await page.cleanup();
  }
});

test("active Task detail keeps lifecycle action order and hides archive while editing", async () => {
  const { api } = createApi(async () => TASK_RESPONSE);
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const labels = [...page.container.querySelectorAll("button")]
      .map((button) => button.textContent);
    assert.equal(labels.filter((label) => label === "返回任务列表").length, 2);
    assert.ok(labels.indexOf("归档") < labels.lastIndexOf("返回任务列表"));
    for (const expected of ["编辑任务", "开始任务", "取消任务", "归档"]) {
      assert.ok(labels.includes(expected));
    }
    const edit = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "编辑任务");
    assert.ok(edit);
    await React.act(async () => {
      edit.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    const editingLabels = [...page.container.querySelectorAll("button")]
      .map((button) => button.textContent);
    assert.ok(editingLabels.includes("保存修改"));
    assert.ok(editingLabels.includes("取消"));
    assert.equal(editingLabels.includes("归档"), false);
  } finally {
    await page.cleanup();
  }
});

test("archived Task list shows exact summary and no lifecycle or business actions", async () => {
  const archivedTask = {
    ...TASK_RESPONSE.data,
    lifecycle_status: "archived" as const,
    allowed_actions: ["reopen"] as const,
  };
  const { api, requests } = createApi(async () => ({
    success: true,
    data: { tasks: [archivedTask], metadata: { count: 1 } },
  }));
  const page = await renderTaskPage(createTaskArchiveLocation("/task?q=abc"), api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(requests[0]?.path, "/task/archived");
    assert.match(page.container.textContent ?? "", /已归档任务/);
    assert.match(page.container.textContent ?? "", /共 1 项，按截止时间排列。/);
    const labels = [...page.container.querySelectorAll("button")]
      .map((button) => button.textContent);
    for (const forbidden of [
      "编辑任务", "开始任务", "完成任务", "取消任务",
      "归档", "恢复", "永久删除",
    ]) {
      assert.equal(labels.includes(forbidden), false);
    }
  } finally {
    await page.cleanup();
  }
});

test("filtered active list enters archive and returns with exact URL, controls, and request", async () => {
  const { api, requests } = createApi(async () => ({
    success: true,
    data: { tasks: [TASK_RESPONSE.data], metadata: { count: 1 } },
  }));
  const page = await renderTaskPage(FILTERED_TASK_LIST, api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const archive = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "查看归档");
    assert.ok(archive);
    await React.act(async () => {
      archive.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(requests.at(-1)?.path, "/task/archived");

    const back = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "返回任务列表");
    assert.ok(back);
    await React.act(async () => {
      back.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      FILTERED_TASK_LIST,
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"搜索任务\"]",
      )?.value,
      "abc",
    );
    assert.equal(
      page.container.querySelector<HTMLSelectElement>(
        "select[aria-label=\"状态筛选\"]",
      )?.value,
      "pending",
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"标签筛选\"]",
      )?.value,
      "work",
    );
    assert.equal(requests.at(-1)?.path, FILTERED_TASK_REQUEST);
  } finally {
    await page.cleanup();
  }
});

test("refreshed archived list returns with exact active filter state and request", async () => {
  const archivedLocation = createTaskArchiveLocation(FILTERED_TASK_LIST);
  const { api, requests } = createApi(async () => ({
    success: true,
    data: { tasks: [TASK_RESPONSE.data], metadata: { count: 1 } },
  }));
  const page = await renderTaskPage(archivedLocation, api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(requests[0]?.path, "/task/archived");
    const back = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "返回任务列表");
    assert.ok(back);
    await React.act(async () => {
      back.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      FILTERED_TASK_LIST,
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"搜索任务\"]",
      )?.value,
      "abc",
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"标签筛选\"]",
      )?.value,
      "work",
    );
    assert.equal(requests.at(-1)?.path, FILTERED_TASK_REQUEST);
  } finally {
    await page.cleanup();
  }
});

test("archived detail return keeps the archived list and original active return chain", async () => {
  const archivedLocation = createTaskArchiveLocation(FILTERED_TASK_LIST);
  const archivedDetail = createArchivedTaskDetailLocation(
    TASK_ID,
    archivedLocation,
  );
  const { api, requests } = createApi(async (path) =>
    path === `/task/archived/${TASK_ID}`
      ? { ...TASK_RESPONSE, data: { ...TASK_RESPONSE.data, lifecycle_status: "archived", allowed_actions: ["reopen"] } }
      : {
        success: true,
        data: { tasks: [TASK_RESPONSE.data], metadata: { count: 1 } },
      }
  );
  const page = await renderTaskPage(archivedDetail, api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const back = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "返回归档列表");
    assert.ok(back);
    assert.equal(
      [...page.container.querySelectorAll("button")]
        .some((button) => button.textContent === "恢复任务"),
      false,
    );
    await React.act(async () => {
      back.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      archivedLocation,
    );
    assert.equal(requests.at(-1)?.path, "/task/archived");
  } finally {
    await page.cleanup();
  }
});

test("undated task detail and edit form preserve the no-due state and account timezone", async () => {
  const response = {
    ...TASK_RESPONSE,
    data: {
      ...TASK_RESPONSE.data,
      due_time: null,
      time_bucket: "no_due_date" as const,
    },
  };
  const { api } = createApi(async () => response);
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);

  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.match(page.container.textContent ?? "", /截止时间：无截止时间/);
    assert.match(page.container.textContent ?? "", /时区：Asia\/Shanghai/);

    const edit = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "编辑任务");
    assert.ok(edit);
    await React.act(async () => {
      edit.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });

    const noDue = page.container.querySelector<HTMLInputElement>(
      ".task-no-due-control input[type=checkbox]",
    );
    assert.equal(noDue?.checked, true);
    assert.match(page.container.textContent ?? "", /当前账户时区：Asia\/Shanghai/);
  } finally {
    await page.cleanup();
  }
});

test("detail failure stays in the safe detail error view without flashing the list", async () => {
  const detail = deferred<unknown>();
  const { api } = createApi(() => detail.promise);
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);

  try {
    await React.act(async () => {
      detail.reject(new Error("not found or forbidden"));
      await detail.promise.catch(() => undefined);
    });
    assert.match(
      page.container.textContent ?? "",
      /读取任务详情失败/,
    );
    assert.doesNotMatch(
      page.container.textContent ?? "",
      /not found or forbidden/,
    );
    assertNoListView(page.container);
  } finally {
    await page.cleanup();
  }
});

test("refreshed detail keeps returnTo and the in-page return restores every filter", async () => {
  const returnTo =
    "/task?q=report&status=pending&priority=high&tag=work";
  const detailLocation = createTaskDetailLocation(
    TASK_ID,
    returnTo,
  );
  const { api } = createApi(() => new Promise(() => {}));
  const page = await renderTaskPage(detailLocation, api);

  try {
    const returnButton = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "返回任务列表");
    assert.ok(returnButton);
    await React.act(async () => {
      returnButton.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });

    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      returnTo,
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"搜索任务\"]",
      )?.value,
      "report",
    );
    assert.equal(
      page.container.querySelector<HTMLSelectElement>(
        "select[aria-label=\"状态筛选\"]",
      )?.value,
      "pending",
    );
  } finally {
    await page.cleanup();
  }
});

test("missing or invalid task parameters render the normal list view", async () => {
  for (const path of [
    "/task?q=report",
    "/task?task=%2Fprivate%2Fpath&q=report",
  ]) {
    const { api, requests } = createApi(
      () => new Promise(() => {}),
    );
    const page = await renderTaskPage(path, api);
    try {
      assert.ok(
        page.container.querySelector(
          "input[aria-label=\"搜索任务\"]",
        ),
      );
      assert.equal(requests[0]?.path, "/task?q=report");
    } finally {
      await page.cleanup();
    }
  }
});

test("popstate switches between list and detail without rendering the wrong view", async () => {
  const { api, requests } = createApi(
    () => new Promise(() => {}),
  );
  const page = await renderTaskPage(
    "/task?q=report&status=pending",
    api,
  );

  try {
    const listSignal = requests[0]?.init?.signal;
    assert.ok(
      page.container.querySelector(
        "input[aria-label=\"搜索任务\"]",
      ),
    );

    const detailLocation = createTaskDetailLocation(
      TASK_ID,
      "/task?q=report&status=pending",
    );
    await React.act(async () => {
      page.window.history.pushState(null, "", detailLocation);
      page.window.dispatchEvent(
        new page.window.PopStateEvent("popstate"),
      );
    });

    assert.equal(listSignal?.aborted, true);
    assert.ok(
      page.container.querySelector(
        "[aria-label=\"任务详情加载中\"]",
      ),
    );
    assertNoListView(page.container);
    assert.equal(requests.at(-1)?.path, `/task/${TASK_ID}`);

    await React.act(async () => {
      page.window.history.pushState(
        null,
        "",
        "/task?q=report&status=pending",
      );
      page.window.dispatchEvent(
        new page.window.PopStateEvent("popstate"),
      );
    });

    assert.ok(
      page.container.querySelector(
        "input[aria-label=\"搜索任务\"]",
      ),
    );
    assert.equal(requests.at(-1)?.path, "/task?q=report&status=pending");
  } finally {
    await page.cleanup();
  }
});

test("active detail archive confirmation cancellation sends no request", async () => {
  const { api, requests } = createApi(async () => TASK_RESPONSE);
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);
  let confirmations = 0;
  page.window.confirm = () => confirmations++ > 0;
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const archive = [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "归档");
    assert.ok(archive);
    await React.act(async () => {
      archive.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(
      requests.filter((request) => request.init?.method === "DELETE").length,
      0,
    );
    await React.act(async () => {
      archive.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(
      requests.filter((request) => request.init?.method === "DELETE").length,
      1,
      "cancelling confirmation must release the archive gate",
    );
  } finally {
    await page.cleanup();
  }
});

test("active detail archive is strict single-flight and restores the exact filtered list", async () => {
  const archive = deferred<unknown>();
  const { api, requests } = createApi((path, init) => {
    if (init?.method === "DELETE") return archive.promise;
    return Promise.resolve(TASK_RESPONSE);
  });
  const returnTo = FILTERED_TASK_LIST;
  const page = await renderTaskPage(createTaskDetailLocation(TASK_ID, returnTo), api);
  page.window.confirm = () => true;
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const button = [...page.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "归档");
    assert.ok(button);
    await React.act(async () => {
      button.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(
      requests.filter((request) => request.init?.method === "DELETE").length,
      1,
    );
    await React.act(async () => {
      archive.resolve({ success: true, data: {} });
      await archive.promise;
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      returnTo,
    );
  } finally {
    await page.cleanup();
  }
});

test("archived detail restore is strict single-flight and returns to the exact active origin", async () => {
  const restore = deferred<unknown>();
  const archivedResponse = {
    ...TASK_RESPONSE,
    data: {
      ...TASK_RESPONSE.data,
      status: "completed" as const,
      completed_at: "2026-07-29T04:00:00.000Z",
      allowed_actions: [] as const,
      lifecycle_status: "archived" as const,
    },
  };
  const { api, requests } = createApi((path, init) => {
    if (init?.method === "POST") return restore.promise;
    return Promise.resolve(archivedResponse);
  });
  const active = FILTERED_TASK_LIST;
  const archivedList = createTaskArchiveLocation(active);
  const detail = createArchivedTaskDetailLocation(TASK_ID, archivedList);
  const page = await renderTaskPage(detail, api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.match(page.container.textContent ?? "", /完成时间/);
    const labels = [...page.container.querySelectorAll("button")]
      .map((candidate) => candidate.textContent);
    for (const forbidden of [
      "编辑任务", "开始任务", "完成任务", "取消任务", "归档",
    ]) {
      assert.equal(labels.includes(forbidden), false);
    }
    const button = [...page.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "恢复");
    assert.ok(button);
    await React.act(async () => {
      button.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(
      requests.filter((request) => request.init?.method === "POST").length,
      1,
    );
    await React.act(async () => {
      restore.resolve({ success: true, data: {} });
      await restore.promise;
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      active,
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"搜索任务\"]",
      )?.value,
      "abc",
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"标签筛选\"]",
      )?.value,
      "work",
    );
    assert.equal(requests.at(-1)?.path, FILTERED_TASK_REQUEST);
  } finally {
    await page.cleanup();
  }
});

test("archived Task permanent-delete pending state blocks desktop and mobile detail exit", async () => {
  const archivedResponse = {
    ...TASK_RESPONSE,
    data: {
      ...TASK_RESPONSE.data,
      lifecycle_status: "archived" as const,
      allowed_actions: ["reopen"] as const,
    },
  };
  for (const mobile of [false, true]) {
    const deletion = deferred<unknown>();
    const createPendingApi = () => createApi((path, init) => {
      if (path === `/task/archived/${TASK_ID}`) return Promise.resolve(archivedResponse);
      if (init?.method === "DELETE") return deletion.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    const { api, requests } = createPendingApi();
    const page = await renderTaskPage(
      createArchivedTaskDetailLocation(TASK_ID, "/task/archived"),
      api,
      undefined,
      mobile,
    );
    try {
      await React.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const deleteButton = [...page.container.querySelectorAll("button")]
        .find((button) => button.textContent === "删除");
      assert.ok(deleteButton);
      await React.act(async () => {
        deleteButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      });
      const confirm = [...page.container.querySelectorAll("button")]
        .find((button) => button.textContent === "确认永久删除");
      assert.ok(confirm);
      await React.act(async () => {
        confirm.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      });
      assert.equal(requests.filter((request) => request.init?.method === "DELETE").length, 1);

      if (!mobile) {
        for (const button of [...page.container.querySelectorAll("button")]
          .filter((candidate) => candidate.textContent === "返回归档列表")) {
          assert.equal(button.disabled, true);
        }
      } else {
        const dialog = page.container.querySelector("[role=dialog]");
        assert.ok(dialog);
        const close = dialog?.parentElement?.querySelector<HTMLButtonElement>(".paper-detail-veil");
        if (close) {
          await React.act(async () => {
            close.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
          });
          assert.match(page.container.textContent ?? "", /删除中…|永久删除后无法恢复/);
        }
      }
    } finally {
      deletion.reject(new Error("delete failed"));
      await deletion.promise.catch(() => undefined);
      await page.cleanup();
    }
  }
});

test("Task dirty create preserves on cancel, retries once, and ignores stale success", async () => {
  const first = deferred<unknown>();
  const retry = deferred<unknown>();
  let createAttempt = 0;
  const { api, requests } = createApi((path, init) => {
    if (init?.method === "POST") {
      createAttempt += 1;
      return createAttempt === 1 ? first.promise : retry.promise;
    }
    if (path === `/task/${TASK_ID}`) return Promise.resolve(TASK_RESPONSE);
    return Promise.resolve({
      success: true,
      data: { tasks: [TASK_RESPONSE.data], metadata: { count: 1 } },
    });
  });
  const page = await renderTaskPage("/task?q=goal", api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const findButton = (label: string) => [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === label);
    await React.act(async () => {
      findButton("新建任务")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    const title = page.container.querySelector<HTMLInputElement>('input[placeholder="任务标题"]');
    const description = page.container.querySelector<HTMLTextAreaElement>('textarea[placeholder="任务说明"]');
    assert.ok(title && description);
    await React.act(async () => {
      title.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(title), "value")?.set?.call(title, "draft task");
      const titleChange = new page.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(titleChange, "propertyName", { value: "value" });
      title.dispatchEvent(titleChange);
      description.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(description), "value")?.set?.call(description, "draft description");
      const descriptionChange = new page.window.Event("propertychange", { bubbles: true });
      Object.defineProperty(descriptionChange, "propertyName", { value: "value" });
      description.dispatchEvent(descriptionChange);
    });
    const authorTrigger = page.container.querySelector<HTMLButtonElement>(".paper-author-signature-trigger");
    assert.ok(authorTrigger);
    await React.act(async () => authorTrigger.click());
    const authorL = page.container.querySelector<HTMLButtonElement>('[role="menuitemradio"][data-author="L"]');
    assert.ok(authorL);
    await React.act(async () => authorL.click());
    let confirmations = 0;
    page.window.confirm = () => {
      confirmations += 1;
      return false;
    };
    await React.act(async () => {
      findButton("取消新建")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(page.window.location.pathname + page.window.location.search, "/task?q=goal");
    assert.equal(title.value, "draft task");
    assert.equal(description.value, "draft description");

    const save = findButton("保存任务");
    assert.ok(save);
    await React.act(async () => {
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter(({ init }) => init?.method === "POST").length, 1);
    const createRequest = requests.find(({ init }) => init?.method === "POST");
    assert.equal(JSON.parse(String(createRequest?.init?.body)).author, "L");
    await React.act(async () => {
      first.reject(new Error("failed"));
      await first.promise.catch(() => undefined);
    });
    assert.equal(title.value, "draft task");
    assert.equal(description.value, "draft description");
    const retryButton = findButton("保存任务");
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
        createTaskDetailLocation(TASK_ID, "/task?q=goal"),
      );
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });
    assert.match(page.window.location.search, new RegExp(`task=${TASK_ID}`));
    assert.equal(page.container.querySelector('input[placeholder="任务标题"]'), null);
    assert.equal(page.window.dispatchEvent(new page.window.Event("beforeunload", { cancelable: true })), true);
    await React.act(async () => {
      retry.resolve(TASK_RESPONSE);
      await retry.promise;
    });
    assert.match(page.window.location.search, new RegExp(`task=${TASK_ID}`));
    assert.equal(confirmations, 2);
  } finally {
    await page.cleanup();
  }
});

test("Task legacy-null edit requires selecting an author before PATCH", async () => {
  const legacyResponse = {
    ...TASK_RESPONSE,
    data: { ...TASK_RESPONSE.data, author: null },
  };
  const { api, requests } = createApi((path, init) => {
    if (path === `/task/${TASK_ID}` && !init?.method) {
      return Promise.resolve(legacyResponse);
    }
    if (path === `/task/${TASK_ID}` && init?.method === "PATCH") {
      return Promise.resolve({
        ...legacyResponse,
        data: { ...legacyResponse.data, author: "G" },
      });
    }
    return Promise.resolve(legacyResponse);
  });
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const edit = [...page.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "编辑任务");
    assert.ok(edit);
    await React.act(async () => edit.click());
    const save = [...page.container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "保存修改");
    assert.ok(save);
    await React.act(async () => save.click());
    assert.match(page.container.textContent ?? "", /请选择作者/);
    assert.equal(requests.some(({ init }) => init?.method === "PATCH"), false);

    const trigger = page.container.querySelector<HTMLButtonElement>(".paper-author-signature-trigger");
    assert.ok(trigger);
    await React.act(async () => trigger.click());
    const authorG = page.container.querySelector<HTMLButtonElement>('[role="menuitemradio"][data-author="G"]');
    assert.ok(authorG);
    await React.act(async () => authorG.click());
    await React.act(async () => save.click());
    const patch = requests.find(({ init }) => init?.method === "PATCH");
    assert.ok(patch);
    assert.equal(JSON.parse(String(patch.init?.body)).author, "G");
  } finally {
    await page.cleanup();
  }
});

test("Task status transition is single-flight, preserves detail on failure, and retries once", async () => {
  const first = deferred<unknown>();
  const retry = deferred<unknown>();
  const legacyStatusResponse = {
    ...TASK_RESPONSE,
    data: { ...TASK_RESPONSE.data, author: null },
  };
  let attempt = 0;
  const { api, requests } = createApi((path, init) => {
    if (path.endsWith("/status") && init?.method === "PATCH") {
      attempt += 1;
      return attempt === 1 ? first.promise : retry.promise;
    }
    return Promise.resolve(legacyStatusResponse);
  });
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const findStart = () => [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === "开始任务");
    const start = findStart();
    assert.ok(start);
    await React.act(async () => {
      start.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      start.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter(({ path }) => path.endsWith("/status")).length, 1);
    const statusRequest = requests.find(({ path }) => path.endsWith("/status"));
    assert.deepEqual(JSON.parse(String(statusRequest?.init?.body)), { status: "in_progress" });
    await React.act(async () => {
      first.reject(new Error("failed"));
      await first.promise.catch(() => undefined);
    });
    assert.match(page.container.textContent ?? "", /详情任务/);
    const retryButton = findStart();
    assert.ok(retryButton);
    await React.act(async () => {
      retryButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      retryButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter(({ path }) => path.endsWith("/status")).length, 2);
    await React.act(async () => {
      retry.resolve({
        ...TASK_RESPONSE,
        data: { ...TASK_RESPONSE.data, status: "in_progress" },
      });
      await retry.promise;
    });
  } finally {
    await page.cleanup();
  }
});

test("completed Task detail exposes a single reopen action and sends one mutation", async () => {
  const response = {
    ...TASK_RESPONSE,
    data: {
      ...TASK_RESPONSE.data,
      status: "completed" as const,
      completed_at: "2026-07-29T04:00:00.000Z",
      allowed_actions: ["reopen"] as const,
    },
  };
  const requests: RequestRecord[] = [];
  const api: WebApiClient = {
    request<T>(path, init) {
      requests.push({ path, init });
      if (path === `/task/${TASK_ID}`) return Promise.resolve(response as T);
      if (path === `/task/${TASK_ID}/reopen`) {
        return Promise.resolve({
          ...response,
          data: { ...response.data, status: "in_progress", completed_at: null, allowed_actions: ["complete", "cancel"] },
        } as T);
      }
      if (path === "/task") return Promise.resolve({ success: true, data: { tasks: [], metadata: { count: 0 } } } as T);
      return Promise.resolve({ success: true, data: { tasks: [], metadata: { count: 0 } } } as T);
    },
  };
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);
  try {
    await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    page.window.history.replaceState({ detail: true }, "", `/task?task=${TASK_ID}`);
    const reopen = [...page.container.querySelectorAll("button")].filter((button) => button.textContent === "恢复任务");
    assert.equal(reopen.length, 1);
    await React.act(async () => {
      reopen[0]!.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      reopen[0]!.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(requests.filter(({ path, init }) => path === `/task/${TASK_ID}/reopen` && init?.method === "POST").length, 1);
    assert.equal(requests.some(({ path, init }) => path === "/task" && !init?.method), false);
    assert.equal(page.window.location.pathname + page.window.location.search, `/task?task=${TASK_ID}`);
    assert.deepEqual(page.window.history.state, { detail: true });
  } finally {
    await page.cleanup();
  }
});

test("Task dirty edit cancellation and update retry are page-level single-flight", async () => {
  const first = deferred<unknown>();
  const retry = deferred<unknown>();
  let updateAttempt = 0;
  const { api, requests } = createApi((path, init) => {
    if (path === `/task/${TASK_ID}` && init?.method === "PATCH") {
      updateAttempt += 1;
      return updateAttempt === 1 ? first.promise : retry.promise;
    }
    return Promise.resolve(TASK_RESPONSE);
  });
  const page = await renderTaskPage(`/task?task=${TASK_ID}`, api);
  try {
    await React.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const findButton = (label: string) => [...page.container.querySelectorAll("button")]
      .find((button) => button.textContent === label);
    const startEdit = async () => {
      await React.act(async () => {
        findButton("编辑任务")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      });
    };
    const changeTitle = async (value: string) => {
      const input = page.container.querySelector<HTMLInputElement>('section.memory-message input:not([type="checkbox"])');
      assert.ok(input);
      await React.act(async () => {
        input.focus();
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set?.call(input, value);
        const change = new page.window.Event("propertychange", { bubbles: true });
        Object.defineProperty(change, "propertyName", { value: "value" });
        input.dispatchEvent(change);
      });
      return input;
    };
    await startEdit();
    assert.equal(
      page.container.querySelector<HTMLButtonElement>(".paper-author-signature-trigger")?.textContent,
      "L",
    );
    let title = await changeTitle("changed task");
    page.window.confirm = () => false;
    await React.act(async () => {
      findButton("取消")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(title.value, "changed task");
    assert.match(page.container.textContent ?? "", /编辑任务/);
    page.window.confirm = () => true;
    await React.act(async () => {
      findButton("取消")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(findButton("保存修改"), undefined);
    assert.equal(page.window.dispatchEvent(new page.window.Event("beforeunload", { cancelable: true })), true);

    await startEdit();
    title = await changeTitle("retry task");
    const save = findButton("保存修改");
    assert.ok(save);
    await React.act(async () => {
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      save.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(
      requests.filter(({ path, init }) => path === `/task/${TASK_ID}` && init?.method === "PATCH").length,
      1,
    );
    await React.act(async () => {
      first.reject(new Error("failed"));
      await first.promise.catch(() => undefined);
    });
    assert.equal(title.value, "retry task");
    const retryButton = findButton("保存修改");
    assert.ok(retryButton);
    await React.act(async () => {
      retryButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
      retryButton.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(
      requests.filter(({ path, init }) => path === `/task/${TASK_ID}` && init?.method === "PATCH").length,
      2,
    );
    await React.act(async () => {
      retry.resolve({
        ...TASK_RESPONSE,
        data: { ...TASK_RESPONSE.data, title: "retry task" },
      });
      await retry.promise;
    });
  } finally {
    await page.cleanup();
  }
});
