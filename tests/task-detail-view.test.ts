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
import { DEFAULT_SETTINGS } from "../web/src/settings/types.js";

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
  },
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
  installGlobal(
    "requestAnimationFrame",
    dom.window.requestAnimationFrame.bind(dom.window),
  );

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(TaskPageContent, {
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
      ["查看归档", "新增任务"],
    );
    assert.match(page.container.textContent ?? "", /共 1 项，按截止时间排列。/);
    const cards = page.container.querySelector(".memory-grid");
    assert.ok(cards);
    assert.equal(
      [...cards.querySelectorAll("button")].some((button) => button.textContent === "归档"),
      false,
    );
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
      ? { ...TASK_RESPONSE, data: { ...TASK_RESPONSE.data, lifecycle_status: "archived" } }
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
      findButton("新增任务")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
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
    let confirmations = 0;
    page.window.confirm = () => {
      confirmations += 1;
      return false;
    };
    await React.act(async () => {
      findButton("取消新增")?.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true }));
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

test("Task status transition is single-flight, preserves detail on failure, and retries once", async () => {
  const first = deferred<unknown>();
  const retry = deferred<unknown>();
  let attempt = 0;
  const { api, requests } = createApi((path, init) => {
    if (path.endsWith("/status") && init?.method === "PATCH") {
      attempt += 1;
      return attempt === 1 ? first.promise : retry.promise;
    }
    return Promise.resolve(TASK_RESPONSE);
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
