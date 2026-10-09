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

test("Mind uses Diary-style count, drains cursors automatically and has no More control", async () => {
  const calls: string[] = [];
  const api = {
    request: async (path: string) => {
      calls.push(path);
      return {
        data: {
          items: path.includes("cursor=")
            ? [{ ...summary, id: "b", snippet: "Second memory" }]
            : Array.from({ length: 50 }, (_, index) => ({
                ...summary,
                id: `first-${index}`,
              })),
          nextCursor: path.includes("cursor=") ? null : "next+page",
        },
      };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    assert.equal(calls.length, 2);
    assert.equal(
      ui.dom.window.document.querySelector(".memory-page-count")?.textContent,
      "51条记忆",
    );
    assert.equal(
      ui.dom.window.document.querySelectorAll(".memory-row").length,
      51,
    );
    assert.equal(
      [...ui.dom.window.document.querySelectorAll("button")].some(
        (x) => x.textContent === "更多",
      ),
      false,
    );
  } finally {
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
      ui.dom.window.document.querySelector(".memory-paper-content")
        ?.textContent,
      item.text,
    );
    await ui.click(ui.button("编辑"));
    assert.ok(
      ui.dom.window.document.querySelector(
        '.paper-detail-date input[type="datetime-local"]',
      ),
    );
    await ui.click(ui.button("取消"));
    await React.act(async () => {
      ui.dom.window.document.dispatchEvent(
        new ui.dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
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
      if (_path.startsWith("/mind/search"))
        return { data: { items: [], nextCursor: null } };
      return { data: item };
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
    const defaultDate = (
      ui.dom.window.document.querySelector(
        'input[type="datetime-local"]',
      ) as HTMLInputElement
    ).value;
    assert.equal(
      defaultDate.slice(0, 10),
      new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
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
      occurred_at: new Date(`${defaultDate}+08:00`).toISOString(),
    });
    assert.equal(
      ui.dom.window.document.querySelector(".memory-paper-content")
        ?.textContent,
      item.text,
    );
    assert.match(ui.dom.window.location.search, /memoryId=a/);
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
    await ui.click(ui.button("编辑"));
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

test("saving stays in reading mode with the refreshed record; deleting focuses the create control", async () => {
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
    await ui.click(ui.button("编辑"));
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
    assert.ok(ui.dom.window.document.querySelector('[role="dialog"]'));
    assert.ok(
      !ui.dom.window.document.querySelector("textarea"),
      "reading mode has no textarea",
    );
    assert.match(row.textContent!, /Updated text/);
    ui.dom.window.confirm = () => true;
    assert.ok(ui.button("删除").closest(".paper-detail-top-right"));
    assert.equal(ui.button("删除").closest(".paper-detail-bottom-left"), null);
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

test("Memory detail starts in reading mode; cancel restores content and save stays in reading mode", async () => {
  let closes = 0;
  const writes: any[] = [];
  const api = {
    request: async (_path: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      writes.push(body);
      return {
        data: {
          ...item,
          text: body.text,
          contentVersion: `v${writes.length + 1}`,
        },
      };
    },
  } as any;
  const ui = await render(
    React.createElement(MemoryDetail, {
      api,
      initial: item,
      onSaved: () => {},
      onClose: () => closes++,
    }),
  );
  try {
    assert.ok(
      !ui.dom.window.document.querySelector("textarea"),
      "reading mode has no textarea",
    );
    assert.equal(
      ui.dom.window.document.querySelector(".memory-paper-content")
        ?.textContent,
      item.text,
    );
    await ui.click(ui.button("编辑"));
    await setInput(
      ui,
      ui.dom.window.document.querySelector("textarea")!,
      "Discarded text",
    );
    ui.dom.window.confirm = () => true;
    await ui.click(ui.button("取消"));
    assert.equal(closes, 0);
    assert.equal(
      ui.dom.window.document.querySelector(".memory-paper-content")
        ?.textContent,
      item.text,
    );
    await ui.click(ui.button("编辑"));
    await setInput(
      ui,
      ui.dom.window.document.querySelector("textarea")!,
      "Saved text",
    );
    await ui.click(ui.button("保存"));
    assert.equal(closes, 0);
    assert.ok(
      !ui.dom.window.document.querySelector("textarea"),
      "reading mode has no textarea",
    );
    assert.equal(
      ui.dom.window.document.querySelector(".memory-paper-content")
        ?.textContent,
      "Saved text",
    );
    await ui.click(ui.button("编辑"));
    await setInput(
      ui,
      ui.dom.window.document.querySelector("textarea")!,
      "Second save",
    );
    await ui.click(ui.button("保存"));
    assert.equal(writes[1].expected_version, "v2");
  } finally {
    await ui.cleanup();
  }
});

test("Mind groups by Beijing occurrence descending across pages, with undated last", async () => {
  const api = {
    request: async (path: string) => ({
      data: {
        items: [
          { ...summary, id: "undated", date: null, occurredAt: null },
          {
            ...summary,
            id: "old",
            date: "2026-01-01",
            occurredAt: "2025-12-31T16:00:00Z",
          },
          {
            ...summary,
            id: "early",
            date: "2026-10-09",
            occurredAt: "2026-10-08T16:00:00Z",
          },
          {
            ...summary,
            id: "late",
            date: "2026-10-09",
            occurredAt: "2026-10-09T01:00:00Z",
          },
        ].slice(
          path.includes("cursor=") ? 2 : 0,
          path.includes("cursor=") ? 4 : 2,
        ),
        nextCursor: path.includes("cursor=") ? null : "second-page",
      },
    }),
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    assert.deepEqual(
      [...ui.dom.window.document.querySelectorAll("[data-memory-id]")].map(
        (x) => x.getAttribute("data-memory-id"),
      ),
      ["late", "early", "old", "undated"],
    );
  } finally {
    await ui.cleanup();
  }
});

test("Mind reuses Diary empty layout and search loading instead of list skeletons", async (t) => {
  const api = {
    request: async (path: string) =>
      path.includes("query=wait")
        ? new Promise(() => {})
        : { data: { items: [], nextCursor: null } },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    assert.ok(ui.dom.window.document.querySelector(".memory-empty-state"));
    assert.match(ui.dom.window.document.body.textContent!, /还没有记忆/);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    await ui.click(
      ui.dom.window.document.querySelector('[aria-label="搜索记忆"]')!,
    );
    await setInput(
      ui,
      ui.dom.window.document.querySelector('input[type="text"]')!,
      "none",
    );
    await React.act(async () => t.mock.timers.tick(250));
    assert.match(
      ui.dom.window.document.body.textContent!,
      /没有符合条件的记忆/,
    );
    await ui.click(ui.button("清除条件"));
    assert.ok(ui.dom.window.document.querySelector(".memory-empty-state"));
    await setInput(
      ui,
      ui.dom.window.document.querySelector('input[type="text"]')!,
      "wait",
    );
    await React.act(async () => t.mock.timers.tick(250));
    assert.match(ui.dom.window.document.body.textContent!, /Searching\.\.\./);
    assert.ok(!ui.dom.window.document.querySelector(".memory-month-skeleton"));
  } finally {
    t.mock.timers.reset();
    await ui.cleanup();
  }
});

test("default occurrence is not a dirty draft; explicitly clearing it still creates an undated memory", async () => {
  let confirms = 0;
  let posted: any;
  const api = {
    request: async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted = JSON.parse(init.body as string);
        return { data: { ...item, occurredAt: null } };
      }
      return path.startsWith("/mind/search")
        ? { data: { items: [], nextCursor: null } }
        : { data: { ...item, occurredAt: null } };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    ui.dom.window.confirm = () => {
      confirms++;
      return true;
    };
    const create = ui.dom.window.document.querySelector(
      '[aria-label="新增记忆"]',
    )!;
    await ui.click(create);
    await ui.click(ui.button("取消"));
    assert.equal(confirms, 0);
    assert.ok(!ui.dom.window.document.querySelector('[role="dialog"]'));
    await ui.click(create);
    await ui.click(ui.button("未指定日期"));
    await setInput(
      ui,
      ui.dom.window.document.querySelector("textarea")!,
      "Undated draft",
    );
    await ui.click(ui.button("保存"));
    assert.equal(posted.occurred_at, null);
    assert.match(ui.dom.window.location.search, /memoryId=a/);
    assert.ok(ui.button("编辑"));
  } finally {
    await ui.cleanup();
  }
});
