import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
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
  id: "memory-a",
  text: "Sample memory",
  occurredAt: "2026-10-07T16:10:00.000Z",
  contentVersion: "v1",
  source: "manual",
  createdAt: "2026-10-07T16:10:00.000Z",
  updatedAt: "2026-10-07T16:10:00.000Z",
};
test("daily Memory paper groups all pages, only views/edits and regroups after date removal", async () => {
  let present = true;
  const methods: string[] = [];
  const webClient = {
    async request(path: string, init?: RequestInit) {
      methods.push(init?.method ?? "GET");
      if (init?.method === "PATCH") {
        present = false;
        return { data: { ...item, occurredAt: null, contentVersion: "v2" } };
      }
      if (path.startsWith("/mind/days/"))
        return { data: { items: present ? [item] : [], nextCursor: null } };
      return { data: item };
    },
  } as any;
  const api = {
    webClient,
    listTodoDates: async () => [],
    listDiaryDates: async () => [],
    loadTodoDay: async (date: string) => ({
      date,
      papers: { L: null, G: null, C: null },
    }),
    loadDiariesByDate: async () => ({ diaries: [] }),
    updateDiary: async () => {
      throw Error("unused");
    },
  };
  const ui = await render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/day-space?date=2026-10-08"] },
      React.createElement(DaySpacePageContent, { api } as any),
    ),
  );
  try {
    const paper = ui.dom.window.document.querySelector(
      ".day-space-paper-memory",
    );
    assert.ok(paper);
    assert.equal(
      ui.dom.window.document.querySelectorAll(".day-space-paper-memory").length,
      1,
    );
    assert.doesNotMatch(
      ui.dom.window.document.body.textContent!,
      /这一天还没有内容/,
    );
    await ui.click(paper);
    assert.ok(
      ui.dom.window.document.querySelector(".diary-paper-content-editor"),
      "one click opens the actual paper body editor",
    );
    assert.equal(
      ui.dom.window.document.querySelectorAll('[role="dialog"]').length,
      1,
    );
    assert.equal(ui.dom.window.document.querySelector(".memory-row"), null);
    assert.equal(
      [...ui.dom.window.document.querySelectorAll("button")].some(
        (b) => b.textContent === "删除",
      ),
      false,
    );
    await ui.click(ui.button("未指定日期"));
    await ui.click(ui.button("保存"));
    assert.equal(
      ui.dom.window.document.querySelector(".day-space-paper-memory"),
      null,
    );
    assert.equal(methods.includes("POST") || methods.includes("DELETE"), false);
  } finally {
    await ui.cleanup();
  }
});
test("409 retains the draft, disables save until explicit reconciliation and uses latest version", async () => {
  const writes: any[] = [];
  const latest = { ...item, text: "Concurrent edit", contentVersion: "v2" };
  const api = {
    async request(_path: string, init?: RequestInit) {
      if (init?.method === "PATCH") {
        writes.push(JSON.parse(init.body as string));
        if (writes.length === 1)
          throw new WebApiError(409, "MIND_CONFLICT", "Conflict");
        return { data: { ...item, occurredAt: null, contentVersion: "v3" } };
      }
      return { data: latest };
    },
  } as any;
  const ui = await render(
    React.createElement(MemoryDetail, {
      api,
      initial: item,
      onSaved: () => {},
      onClose: () => {},
    }),
  );
  try {
    await ui.click(ui.button("未指定日期"));
    await ui.click(ui.button("保存"));
    assert.equal(
      (ui.dom.window.document.querySelector("textarea") as HTMLTextAreaElement)
        .value,
      item.text,
    );
    assert.match(ui.dom.window.document.body.textContent!, /Concurrent edit/);
    assert.equal(ui.button("保存").disabled, true);
    assert.equal(writes.length, 1);
    await ui.click(ui.button("保留草稿继续编辑"));
    await ui.click(ui.button("保存"));
    assert.equal(writes.length, 2);
    assert.equal(writes[1].expected_version, "v2");
    assert.equal(writes[1].occurred_at, null);
  } finally {
    await ui.cleanup();
  }
});
test("Mind undated entry filters before pagination and opens editable detail", async () => {
  const { MindPageContent } = await import("../web/src/pages/MindPage.js");
  const calls: string[] = [];
  const api = {
    async request(path: string) {
      calls.push(path);
      if (path.startsWith("/mind/search")) {
        const u = new URL(path, "http://local");
        return {
          data: {
            items: u.searchParams.get("cursor")
              ? [
                  {
                    id: "b",
                    snippet: "Second undated",
                    date: null,
                    occurredAt: null,
                  },
                ]
              : [
                  {
                    id: "a",
                    snippet: "First undated",
                    date: null,
                    occurredAt: null,
                  },
                ],
            nextCursor: u.searchParams.get("cursor") ? null : "page2",
          },
        };
      }
      return { data: { ...item, id: "a", occurredAt: null } };
    },
  } as any;
  const ui = await render(React.createElement(MindPageContent, { api }));
  try {
    await ui.click(ui.button("未指定日期"));
    assert.match(calls.at(-1)!, /undated=true/);
    await ui.click(ui.button("更多"));
    assert.match(calls.at(-1)!, /undated=true&cursor=page2/);
    assert.match(ui.dom.window.document.body.textContent!, /Second undated/);
    await ui.click(ui.dom.window.document.querySelector(".memory-row")!);
    assert.ok(ui.dom.window.document.querySelector("textarea"));
    assert.ok(ui.button("删除"));
    assert.ok(ui.button("保存"));
  } finally {
    await ui.cleanup();
  }
});
test("Beijing datetime edit sends the new event instant and leaves text untouched", async () => {
  let patch: any;
  const api = {
    async request(_path: string, init?: RequestInit) {
      patch = JSON.parse(init?.body as string);
      return {
        data: { ...item, occurredAt: patch.occurred_at, contentVersion: "v2" },
      };
    },
  } as any;
  const ui = await render(
    React.createElement(MemoryDetail, {
      api,
      initial: item,
      onSaved: () => {},
      onClose: () => {},
    }),
  );
  try {
    const input = ui.dom.window.document.querySelector(
      'input[type="datetime-local"]',
    ) as HTMLInputElement;
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(
        ui.dom.window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "2026-10-09T12:30");
      input.dispatchEvent(new ui.dom.window.Event("input", { bubbles: true }));
    });
    await ui.click(ui.button("保存"));
    assert.deepEqual(patch, {
      expected_version: "v1",
      occurred_at: "2026-10-09T04:30:00.000Z",
    });
  } finally {
    await ui.cleanup();
  }
});
test("failed conflict read blocks saving until latest content is retrieved", async () => {
  let reads = 0;
  let writes = 0;
  const api = {
    async request(_path: string, init?: RequestInit) {
      if (init?.method === "PATCH") {
        writes++;
        throw new WebApiError(409, "MIND_CONFLICT", "Conflict");
      }
      if (++reads === 1) throw Error("offline");
      return { data: { ...item, text: "Latest text", contentVersion: "v2" } };
    },
  } as any;
  const ui = await render(
    React.createElement(MemoryDetail, {
      api,
      initial: item,
      onSaved: () => {},
      onClose: () => {},
    }),
  );
  try {
    await ui.click(ui.button("未指定日期"));
    await ui.click(ui.button("保存"));
    assert.equal(ui.button("保存").disabled, true);
    assert.equal(
      (ui.dom.window.document.querySelector("textarea") as HTMLTextAreaElement)
        .value,
      item.text,
    );
    await ui.click(ui.button("读取最新内容"));
    assert.match(ui.dom.window.document.body.textContent!, /Latest text/);
    assert.equal(ui.button("保存").disabled, true);
    assert.equal(writes, 1);
    await ui.click(ui.button("使用最新内容"));
    assert.equal(
      (ui.dom.window.document.querySelector("textarea") as HTMLTextAreaElement)
        .value,
      "Latest text",
    );
  } finally {
    await ui.cleanup();
  }
});
test("late response from a previous day cannot replace the currently selected day", async () => {
  let resolveOld!: (page: any) => void;
  const api = {
    webClient: {
      request: async (path: string) =>
        path.includes("/2026-10-08?")
          ? new Promise((resolve) => {
              resolveOld = resolve;
            })
          : {
              data: {
                items: [{ ...item, text: "Current day memory" }],
                nextCursor: null,
              },
            },
    },
    listTodoDates: async () => [],
    listDiaryDates: async () => [],
    loadTodoDay: async (date: string) => ({
      date,
      papers: { L: null, G: null, C: null },
    }),
    loadDiariesByDate: async () => ({ diaries: [] }),
    updateDiary: async () => {
      throw Error("unused");
    },
  } as any;
  const ui = await render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/day-space?date=2026-10-08"] },
      React.createElement(DaySpacePageContent, { api }),
    ),
  );
  try {
    await ui.click(
      ui.dom.window.document.querySelector('[aria-label="后一天"]')!,
    );
    assert.match(
      ui.dom.window.document.body.textContent!,
      /Current day memory/,
    );
    await React.act(async () =>
      resolveOld({
        data: {
          items: [{ ...item, text: "Stale previous day" }],
          nextCursor: null,
        },
      }),
    );
    assert.doesNotMatch(
      ui.dom.window.document.body.textContent!,
      /Stale previous day/,
    );
  } finally {
    await ui.cleanup();
  }
});

test("one daily paper keeps per-record versions and does not replay successful edits after a later conflict", async () => {
  const writes: any[] = [];
  const committed: string[] = [];
  let closes = 0;
  const second = {
    ...item,
    id: "memory-b",
    contentVersion: "b1",
    text: "Second memory",
  };
  const api = {
    request: async (path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(init.body as string);
        writes.push({ path, ...body });
        if (path.endsWith("memory-b") && body.expected_version === "b1")
          throw new WebApiError(409, "MIND_CONFLICT", "Conflict");
        return {
          data: {
            ...(path.endsWith("memory-b") ? second : item),
            occurredAt: null,
            contentVersion: "saved",
          },
        };
      }
      return { data: { ...second, contentVersion: "b2" } };
    },
  } as any;
  const ui = await render(
    React.createElement(MemoryPaper, {
      api,
      initial: [item, second],
      date: "2026-10-08",
      triggerRef: { current: null },
      onSaved: (x: any) => committed.push(x.id),
      onClose: () => closes++,
    }),
  );
  try {
    assert.equal(ui.dom.window.document.querySelectorAll("textarea").length, 2);
    const clear = [...ui.dom.window.document.querySelectorAll("button")].filter(
      (x) => x.textContent === "未指定日期",
    );
    await ui.click(clear[0]);
    await ui.click(clear[1]);
    await ui.click(ui.button("保存"));
    assert.deepEqual(committed, ["memory-a"]);
    assert.equal(closes, 0);
    assert.equal(ui.button("保存").disabled, true);
    await ui.click(ui.button("保留草稿继续编辑"));
    await ui.click(ui.button("保存"));
    assert.deepEqual(
      writes.map((x) => [x.path, x.expected_version]),
      [
        ["/mind/memory-a", "v1"],
        ["/mind/memory-b", "b1"],
        ["/mind/memory-b", "b2"],
      ],
    );
    assert.deepEqual(committed, ["memory-a", "memory-b"]);
    assert.equal(closes, 1);
  } finally {
    await ui.cleanup();
  }
});

test("closing a clean daily paper returns focus to its actual card", async () => {
  function Host() {
    const [open, setOpen] = React.useState(true);
    const trigger = React.useRef<HTMLButtonElement | null>(null);
    return React.createElement(
      "div",
      null,
      React.createElement("button", { ref: trigger }, "Card"),
      open
        ? React.createElement(MemoryPaper, {
            api: {} as any,
            initial: [item],
            date: "2026-10-08",
            triggerRef: trigger,
            onSaved: () => {},
            onClose: () => setOpen(false),
          })
        : null,
    );
  }
  const ui = await render(React.createElement(Host));
  try {
    await ui.click(ui.button("取消"));
    assert.equal(ui.dom.window.document.querySelector('[role="dialog"]'), null);
    assert.equal(ui.dom.window.document.activeElement, ui.button("Card"));
  } finally {
    await ui.cleanup();
  }
});

test("same-day full retry reloads Memory after all modules fail", async () => {
  let failed = true;
  let reads = 0;
  const api = {
    webClient: {
      request: async () => {
        reads++;
        if (failed) throw Error("offline");
        return { data: { items: [item], nextCursor: null } };
      },
    },
    listTodoDates: async () => [],
    listDiaryDates: async () => [],
    loadTodoDay: async (date: string) => {
      if (failed) throw Error("offline");
      return { date, papers: { L: null, G: null, C: null } };
    },
    loadDiariesByDate: async () => {
      if (failed) throw Error("offline");
      return { diaries: [] };
    },
  } as any;
  const ui = await render(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/day-space?date=2026-10-08"] },
      React.createElement(DaySpacePageContent, { api }),
    ),
  );
  try {
    assert.match(
      ui.dom.window.document.body.textContent!,
      /Unable to read Day Space/,
    );
    const before = reads;
    failed = false;
    await ui.click(ui.button("Retry"));
    assert.ok(reads > before);
    assert.ok(ui.dom.window.document.querySelector(".day-space-paper-memory"));
    assert.doesNotMatch(
      ui.dom.window.document.body.textContent!,
      /Reading\.\.\./,
    );
  } finally {
    await ui.cleanup();
  }
});
