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
  createTaskDetailLocation,
} from "../web/src/pages/task-location.js";
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
  installGlobal("Node", dom.window.Node);
  installGlobal("Event", dom.window.Event);
  installGlobal("MouseEvent", dom.window.MouseEvent);
  installGlobal("PopStateEvent", dom.window.PopStateEvent);
  installGlobal("React", React);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
}

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
