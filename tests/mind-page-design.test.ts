import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { MindPageContent } from "../web/src/pages/MindPage.js";
import { MemoryRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import { DaySpacePageContent } from "../web/src/pages/DaySpacePage.js";
import { MemoryDetail, MemoryPaper } from "../web/src/pages/MemoryDetail.js";
import { WebApiError } from "../web/src/api/web-api-error.js";

async function render(element: React.ReactNode) {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost/day-space?date=2026-10-08",
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (f: () => void) => setTimeout(f, 0),
  };
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  dom.window.scrollTo = () => {};
  dom.window.confirm = () => false;
  const { createRoot } =
    await import("../web/node_modules/react-dom/client.js");
  const root = createRoot(dom.window.document.querySelector("#root")!);
  await React.act(async () => {
    root.render(element);
  });
  const click = async (button: Element) =>
    React.act(async () => {
      (button as HTMLButtonElement).click();
    });
  return {
    dom,
    click,
    button: (text: string) => {
      const b = [...dom.window.document.querySelectorAll("button")].find(
        (x) => x.textContent === text,
      );
      assert.ok(b, `button ${text}`);
      return b;
    },
    cleanup: async () => {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [key, desc] of previous) {
        if (desc) Object.defineProperty(globalThis, key, desc);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
const item = {
  id: "a",
  text: "First memory",
  occurredAt: "2026-10-08T00:00:00.000Z",
  contentVersion: "v1",
  source: "manual",
  createdAt: "2026-10-08T00:00:00.000Z",
  updatedAt: "2026-10-08T00:00:00.000Z",
};
const summary = {
  id: "a",
  snippet: item.text,
  occurredAt: item.occurredAt,
  date: "2026-10-08",
};

test("Mind uses existing module tools and paper creation; undated records stay visible without a filter entry", async () => {
  const calls: string[] = [];
  const api = {
    request: async (path: string) => {
      calls.push(path);
      return {
        data: {
          items: [
            summary,
            {
              ...summary,
              id: "b",
              snippet: "No date memory",
              date: null,
              occurredAt: null,
            },
          ],
          nextCursor: null,
        },
      };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    assert.ok(ui.dom.window.document.querySelector('[aria-label="搜索记忆"]'));
    assert.doesNotMatch(ui.dom.window.document.body.textContent!, /未指定日期/);
    assert.match(ui.dom.window.document.body.textContent!, /No date memory/);
    assert.equal(
      ui.dom.window.document.querySelectorAll(".memory-row").length,
      2,
    );
    await ui.click(
      ui.dom.window.document.querySelector('[aria-label="新增记忆"]')!,
    );
    assert.ok(
      ui.dom.window.document.querySelector(
        ".paper-detail-paper textarea.paper-body-editor",
      ),
    );
    assert.equal(ui.dom.window.document.querySelector(".memory-editor"), null);
    assert.equal(calls.length, 1);
  } finally {
    await ui.cleanup();
  }
});

async function setInput(
  ui: Awaited<ReturnType<typeof render>>,
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await React.act(async () => {
    const prototype =
      input.tagName === "TEXTAREA"
        ? ui.dom.window.HTMLTextAreaElement.prototype
        : ui.dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new ui.dom.window.Event("input", { bubbles: true }));
  });
}

test("search and date filters stay in the cursor context; invalid dates do not send requests", async (t) => {
  const calls: string[] = [];
  const api = {
    request: async (path: string) => {
      calls.push(path);
      return {
        data: {
          items: [summary],
          nextCursor: path.includes("cursor=") ? null : "next+page",
        },
      };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await ui.click(
      ui.dom.window.document.querySelector('[aria-label="搜索记忆"]')!,
    );
    await setInput(
      ui,
      ui.dom.window.document.querySelector('input[type="text"]')!,
      "First",
    );
    await React.act(async () => t.mock.timers.tick(250));
    assert.match(calls.at(-1)!, /query=First/);
    await ui.click(
      ui.dom.window.document.querySelector('[aria-label="按日期筛选"]')!,
    );
    await ui.click(ui.button("自定义范围"));
    const from = ui.dom.window.document.querySelector(
      '[aria-label="Mind 自定义开始时间"]',
    ) as HTMLInputElement;
    const to = ui.dom.window.document.querySelector(
      '[aria-label="Mind 自定义结束时间"]',
    ) as HTMLInputElement;
    await setInput(ui, from, "2026-10-01");
    await setInput(ui, to, "2026-10-31");
    await ui.click(ui.button("更多"));
    const url = new URL(calls.at(-1)!, "http://local");
    assert.equal(url.searchParams.get("query"), "First");
    assert.equal(url.searchParams.get("date_from"), "2026-10-01");
    assert.equal(url.searchParams.get("date_to"), "2026-10-31");
    assert.equal(url.searchParams.get("cursor"), "next+page");
    assert.equal(
      ui.dom.window.document.querySelectorAll(".memory-row").length,
      1,
    );
    const before = calls.length;
    await ui.click(
      ui.dom.window.document.querySelector('[aria-label="按日期筛选"]')!,
    );
    await setInput(
      ui,
      ui.dom.window.document.querySelector(
        '[aria-label="Mind 自定义开始时间"]',
      )!,
      "2026-11-01",
    );
    assert.equal(calls.length, before);
    assert.match(
      ui.dom.window.document.body.textContent!,
      /开始日期不能晚于结束日期/,
    );
  } finally {
    t.mock.timers.reset();
    await ui.cleanup();
  }
});

test("a delayed previous filter response cannot replace the current search", async (t) => {
  let resolveOld!: (value: any) => void;
  const api = {
    request: async (path: string) =>
      path.includes("query=First")
        ? {
            data: {
              items: [{ ...summary, snippet: "Current search" }],
              nextCursor: null,
            },
          }
        : new Promise((resolve) => {
            resolveOld = resolve;
          }),
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await ui.click(
      ui.dom.window.document.querySelector('[aria-label="搜索记忆"]')!,
    );
    await setInput(
      ui,
      ui.dom.window.document.querySelector('input[type="text"]')!,
      "First",
    );
    await React.act(async () => t.mock.timers.tick(250));
    await React.act(async () =>
      resolveOld({
        data: {
          items: [{ ...summary, snippet: "Stale result" }],
          nextCursor: "stale",
        },
      }),
    );
    assert.match(ui.dom.window.document.body.textContent!, /Current search/);
    assert.doesNotMatch(
      ui.dom.window.document.body.textContent!,
      /Stale result/,
    );
    assert.equal(
      [...ui.dom.window.document.querySelectorAll("button")].some(
        (x) => x.textContent === "更多",
      ),
      false,
    );
  } finally {
    t.mock.timers.reset();
    await ui.cleanup();
  }
});

test("detail retry stays in the paper and close restores focus to the clicked row", async () => {
  let failed = true;
  const api = {
    request: async (path: string) => {
      if (path.startsWith("/mind/search"))
        return { data: { items: [summary], nextCursor: null } };
      if (failed) throw Error("offline");
      return { data: item };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    const row = ui.dom.window.document.querySelector(".memory-row")!;
    await ui.click(row);
    assert.ok(
      ui.dom.window.document.querySelector('[role="dialog"] [role="alert"]'),
    );
    failed = false;
    await ui.click(ui.button("Retry"));
    assert.equal(
      (ui.dom.window.document.querySelector("textarea") as HTMLTextAreaElement)
        .value,
      item.text,
    );
    assert.ok(
      ui.dom.window.document.querySelector(
        '.paper-detail-date input[type="datetime-local"]',
      ),
    );
    await ui.click(ui.button("取消"));
    assert.equal(ui.dom.window.document.querySelector('[role="dialog"]'), null);
    assert.equal(ui.dom.window.document.activeElement, row);
  } finally {
    await ui.cleanup();
  }
});

test("creation blocks duplicate submits, keeps failed drafts and reuses idempotency identity on retry", async () => {
  const writes: RequestInit[] = [];
  let fail = true;
  const api = {
    request: async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push(init);
        if (fail) throw Error("offline");
        return { data: item };
      }
      return { data: { items: [], nextCursor: null } };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    await ui.click(
      ui.dom.window.document.querySelector('[aria-label="新增记忆"]')!,
    );
    await setInput(
      ui,
      ui.dom.window.document.querySelector("textarea")!,
      "New local memory",
    );
    const save = ui.button("保存");
    await React.act(async () => {
      save.click();
      save.click();
    });
    assert.equal(writes.length, 1);
    assert.equal(
      (ui.dom.window.document.querySelector("textarea") as HTMLTextAreaElement)
        .value,
      "New local memory",
    );
    await ui.click(ui.button("取消"));
    assert.ok(ui.dom.window.document.querySelector('[role="dialog"]'));
    fail = false;
    await ui.click(ui.button("保存"));
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0].headers, writes[1].headers);
    assert.deepEqual(JSON.parse(writes[1].body as string), {
      kind: "memory",
      text: "New local memory",
      occurred_at: null,
    });
    assert.equal(ui.dom.window.document.querySelector('[role="dialog"]'), null);
  } finally {
    await ui.cleanup();
  }
});

test("browser Back cannot silently discard an edited memory and restores filters when permitted", async () => {
  const api = {
    request: async (path: string) =>
      path.startsWith("/mind/search")
        ? { data: { items: [summary], nextCursor: null } }
        : { data: item },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    await ui.click(ui.dom.window.document.querySelector(".memory-row")!);
    await setInput(
      ui,
      ui.dom.window.document.querySelector("textarea")!,
      "Unsaved draft",
    );
    await React.act(async () => {
      ui.dom.window.history.replaceState(null, "", "/mind?q=restored");
      ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent("popstate"));
    });
    assert.equal(
      (ui.dom.window.document.querySelector("textarea") as HTMLTextAreaElement)
        .value,
      "Unsaved draft",
    );
    assert.match(ui.dom.window.location.search, /memoryId=a/);
    ui.dom.window.confirm = () => true;
    await React.act(async () => {
      ui.dom.window.history.replaceState(null, "", "/mind?q=restored");
      ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent("popstate"));
    });
    assert.equal(ui.dom.window.document.querySelector('[role="dialog"]'), null);
    assert.equal(
      (
        ui.dom.window.document.querySelector(
          'input[type="text"]',
        ) as HTMLInputElement
      ).value,
      "restored",
    );
  } finally {
    await ui.cleanup();
  }
});

test("saving uses the original version and focuses the refreshed record; deleting focuses the create control", async () => {
  let current = { ...item };
  let deleted = false;
  const writes: any[] = [];
  const api = {
    request: async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        writes.push(body);
        current = { ...current, text: body.text, contentVersion: "v2" };
        return { data: current };
      }
      if (init?.method === "DELETE") {
        deleted = true;
        return;
      }
      if (path.startsWith("/mind/search"))
        return {
          data: {
            items: deleted ? [] : [{ ...summary, snippet: current.text }],
            nextCursor: null,
          },
        };
      return { data: current };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    await ui.click(ui.dom.window.document.querySelector(".memory-row")!);
    await setInput(
      ui,
      ui.dom.window.document.querySelector("textarea")!,
      "Updated text",
    );
    await ui.click(ui.button("保存"));
    assert.deepEqual(writes, [
      { expected_version: "v1", text: "Updated text" },
    ]);
    const row = ui.dom.window.document.querySelector(".memory-row")!;
    assert.equal(ui.dom.window.document.activeElement, row);
    assert.match(row.textContent!, /Updated text/);
    await ui.click(row);
    ui.dom.window.confirm = () => true;
    await ui.click(ui.button("删除"));
    assert.equal(
      ui.dom.window.document.querySelectorAll(".memory-row").length,
      0,
    );
    assert.equal(
      ui.dom.window.document.activeElement,
      ui.dom.window.document.querySelector('[aria-label="新增记忆"]'),
    );
  } finally {
    await ui.cleanup();
  }
});

test("pagination failure retains rows; retry is single flight and a later filter fences the old page", async (t) => {
  let fail = true;
  let resolvePage!: (page: any) => void;
  let moreCalls = 0;
  const api = {
    request: async (path: string) => {
      if (path.includes("query=First"))
        return {
          data: {
            items: [{ ...summary, snippet: "Filtered row" }],
            nextCursor: null,
          },
        };
      if (path.includes("cursor=")) {
        moreCalls++;
        if (fail) throw Error("offline");
        return new Promise((resolve) => {
          resolvePage = resolve;
        });
      }
      return { data: { items: [summary], nextCursor: "page2" } };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    await ui.click(ui.button("更多"));
    assert.equal(
      ui.dom.window.document.querySelectorAll(".memory-row").length,
      1,
    );
    fail = false;
    const retry = ui.button("Retry");
    await React.act(async () => {
      retry.click();
      retry.click();
    });
    assert.equal(moreCalls, 2);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await ui.click(
      ui.dom.window.document.querySelector('[aria-label="搜索记忆"]')!,
    );
    await setInput(
      ui,
      ui.dom.window.document.querySelector('input[type="text"]')!,
      "First",
    );
    await React.act(async () => t.mock.timers.tick(250));
    await React.act(async () =>
      resolvePage({
        data: {
          items: [{ ...summary, id: "stale", snippet: "Stale page" }],
          nextCursor: "wrong",
        },
      }),
    );
    assert.match(ui.dom.window.document.body.textContent!, /Filtered row/);
    assert.doesNotMatch(ui.dom.window.document.body.textContent!, /Stale page/);
  } finally {
    t.mock.timers.reset();
    await ui.cleanup();
  }
});

test("an aborted detail response cannot reopen a memory after Back", async () => {
  let resolveDetail!: (value: any) => void;
  const api = {
    request: async (path: string) =>
      path.startsWith("/mind/search")
        ? { data: { items: [summary], nextCursor: null } }
        : new Promise((resolve) => {
            resolveDetail = resolve;
          }),
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    await ui.click(ui.dom.window.document.querySelector(".memory-row")!);
    await React.act(async () => {
      ui.dom.window.history.replaceState(null, "", "/mind");
      ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent("popstate"));
    });
    await React.act(async () => resolveDetail({ data: item }));
    assert.equal(ui.dom.window.document.querySelector('[role="dialog"]'), null);
  } finally {
    await ui.cleanup();
  }
});

test("Back from a clean detail retains the current paginated list and row focus", async () => {
  let reads = 0;
  const api = {
    request: async (path: string) => {
      if (path.startsWith("/mind/search")) {
        reads++;
        return { data: { items: [summary], nextCursor: null } };
      }
      return { data: item };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    const row = ui.dom.window.document.querySelector(".memory-row")!;
    await ui.click(row);
    await React.act(async () => {
      ui.dom.window.history.replaceState(null, "", "/mind");
      ui.dom.window.dispatchEvent(new ui.dom.window.PopStateEvent("popstate"));
    });
    assert.equal(reads, 1);
    assert.equal(ui.dom.window.document.querySelector('[role="dialog"]'), null);
    assert.equal(ui.dom.window.document.activeElement, row);
  } finally {
    await ui.cleanup();
  }
});
