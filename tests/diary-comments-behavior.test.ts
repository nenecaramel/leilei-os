import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { renderToStaticMarkup } from "../web/node_modules/react-dom/server.js";
import { WebApiError, type WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  DiaryCommentsSection,
  type DiaryComment,
  type DiaryCommentsMetadata,
} from "../web/src/pages/DiaryComments.js";

function comment(id = "c-2", overrides: Partial<DiaryComment> = {}): DiaryComment {
  return {
    id, diary_id: "diary/a", author: "L", content: "original", revision: 1,
    created_at: "invalid time", updated_at: "invalid time", ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function render(
  respond: (path: string, init?: RequestInit) => unknown,
  options: { comments?: DiaryComment[]; metadata?: DiaryCommentsMetadata; readOnly?: boolean } = {},
) {
  const dom = new JSDOM("<main id='root'></main>", { url: "https://leilei.test/diary" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Node: dom.window.Node, React, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let scrollCalls = 0;
  dom.window.HTMLElement.prototype.scrollIntoView = () => { scrollCalls += 1; };
  // Run the scheduled scroll immediately; no real browser or scrolling service.
  dom.window.requestAnimationFrame = (callback) => { callback(0); return 1; };
  dom.window.cancelAnimationFrame = () => {};
  // React's input fallback can use these on the first jsdom-mounted input.
  (dom.window.HTMLElement.prototype as any).attachEvent = () => {};
  (dom.window.HTMLElement.prototype as any).detachEvent = () => {};
  const requests: { path: string; init?: RequestInit }[] = [];
  const updates: { comments: DiaryComment[]; metadata: DiaryCommentsMetadata }[] = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      return await respond(path, init) as T;
    },
  };
  function Harness() {
    const [comments, setComments] = React.useState(options.comments ?? [comment()]);
    const [metadata, setMetadata] = React.useState(options.metadata ?? { count: 1, returned: 1, truncated: false });
    return React.createElement(DiaryCommentsSection, {
      api, diaryId: "diary/a", comments, metadata, readOnly: options.readOnly ?? false,
      onChange(nextComments: DiaryComment[], nextMetadata: DiaryCommentsMetadata) {
        updates.push({ comments: nextComments, metadata: nextMetadata });
        setComments(nextComments);
        setMetadata(nextMetadata);
      },
    });
  }
  const container = dom.window.document.getElementById("root")!;
  // Initialize React DOM after jsdom so it detects browser input events.
  const { createRoot } = await import("../web/node_modules/react-dom/client.js");
  const root = createRoot(container);
  await React.act(async () => { root.render(React.createElement(Harness)); });
  return {
    container, requests, updates, window: dom.window,
    scrollCalls: () => scrollCalls,
    button(text: string, scope: ParentNode = container): HTMLButtonElement {
      const button = [...scope.querySelectorAll("button")].find((node) => node.textContent === text);
      assert.ok(button, `missing button ${text}`);
      return button;
    },
    async click(button: HTMLButtonElement) { await React.act(async () => { button.click(); }); },
    async type(textarea: HTMLTextAreaElement, value: string) {
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
        textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
    },
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("read-only comment DOM keeps exact wrappers, copy and edited marker", () => {
  const props = {
    api: { request: async () => { throw new Error("unexpected request"); } } as WebApiClient,
    diaryId: "diary/a", comments: [comment("c-1", { updated_at: "later", content: "hello <world>" })],
    metadata: { count: 1, returned: 1, truncated: false }, readOnly: true,
    onChange() { throw new Error("unexpected update"); },
  };
  assert.equal(renderToStaticMarkup(React.createElement(DiaryCommentsSection, props)),
    '<section class="diary-comments" aria-label="Diary comments"><div class="diary-comment-list"><article class="diary-comment" data-comment-id="c-1"><div class="diary-comment-meta"><span>L · invalid time · 已编辑</span></div><p class="diary-comment-content">hello &lt;world&gt;</p></article></div></section>');
  assert.equal(renderToStaticMarkup(React.createElement(DiaryCommentsSection, {
    ...props, comments: [], metadata: { count: 0, returned: 0, truncated: false },
  })), "");
});

test("composer retains DOM position, textarea identity, focus and retry idempotency", async () => {
  let attempt = 0;
  const pending = deferred<unknown>();
  const env = await render((_path, init) => {
    assert.equal(init?.method, "POST");
    attempt += 1;
    return attempt === 1 ? Promise.reject(new Error("offline")) : pending.promise;
  });
  try {
    await env.click(env.button("写一条评论…"));
    assert.deepEqual([...env.container.querySelector("section")!.children].map((node) => node.className),
      ["diary-comment-composer", "diary-comment-list"]);
    const textarea = env.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="写一条评论"]')!;
    textarea.focus();
    await env.type(textarea, " draft ");
    textarea.setSelectionRange(2, 4);
    assert.equal(textarea.rows, 1);
    assert.equal(textarea.style.height, "30px");
    assert.equal(env.window.document.activeElement, textarea);
    assert.equal(env.container.querySelector("textarea"), textarea);
    assert.equal(env.scrollCalls(), 1);
    await env.click(env.button("保存"));
    assert.match(env.container.querySelector('[role="alert"]')!.textContent!, /评论保存失败，请稍后重试。/);
    assert.equal(env.container.querySelector("textarea"), textarea);
    assert.equal(textarea.value, " draft ");
    assert.equal(textarea.selectionStart, 2);
    assert.equal(textarea.selectionEnd, 4);
    await env.click(env.button("保存"));
    assert.equal(textarea.disabled, true);
    assert.equal(env.button("取消").disabled, true);
    await env.click(env.button("保存中…"));
    assert.equal(env.requests.length, 2);
    const bodies = env.requests.map(({ init }) => JSON.parse(init!.body as string));
    assert.deepEqual(bodies[0], bodies[1]);
    assert.match(bodies[0].idempotency_key, /^web:diary-comment:/);
    assert.equal(bodies[0].content, "draft");
    assert.equal(env.requests[0].path, "/diary/diary%2Fa/comments");
    await React.act(async () => pending.resolve({ success: true, data: {
      comment: comment("c-1", { content: "draft" }), metadata: { created: true, idempotent_replay: false },
    } }));
    assert.equal(env.container.querySelector("textarea"), null);
    assert.deepEqual(env.updates[0].comments.map(({ id }) => id), ["c-1", "c-2"]);
    assert.deepEqual(env.updates[0].metadata, { count: 2, returned: 2, truncated: false });
  } finally { await env.cleanup(); }
});

test("overlapping older pages merge once and forward the exact opaque cursor", async () => {
  let page = 0;
  const env = await render(() => {
    page += 1;
    return { success: true, data: {
      comments: page === 1 ? [comment("c-1"), comment("c-2", { revision: 2 })] : [comment("c-0"), comment("c-1")],
      metadata: { count: 3, returned: 2, has_more: page === 1, next_before: page === 1 ? "opaque +/=" : null },
    } };
  }, { metadata: { count: 3, returned: 1, truncated: true } });
  try {
    await env.click(env.button("查看更早评论"));
    assert.equal(env.requests[0].path, "/diary/diary%2Fa/comments?limit=100");
    assert.deepEqual(env.updates[0].comments.map(({ id }) => id), ["c-1", "c-2"]);
    assert.equal(env.updates[0].comments[1].revision, 2);
    await env.click(env.button("查看更早评论"));
    const query = new URL(env.requests[1].path, "https://leilei.test").searchParams;
    assert.equal(query.get("before"), "opaque +/=");
    assert.equal(query.get("limit"), "100");
    assert.deepEqual(env.updates[1].comments.map(({ id }) => id), ["c-0", "c-1", "c-2"]);
    assert.deepEqual(env.updates[1].metadata, { count: 3, returned: 3, truncated: false });
    assert.equal(env.container.querySelector(".diary-comment-older"), null);
  } finally { await env.cleanup(); }
});

test("edit conflict preserves the draft until explicit latest load and keeps revision CAS", async () => {
  let patch = 0;
  const latest = comment("c-2", { content: "server latest", revision: 3 });
  const env = await render((_path, init) => {
    if (init?.method === "PATCH") {
      patch += 1;
      if (patch === 1) throw new WebApiError(409, "COMMENT_REVISION_CONFLICT", "conflict");
      return { success: true, data: { ...latest, content: "after reload", revision: 4 } };
    }
    return { success: true, data: latest };
  });
  try {
    await env.click(env.button("编辑"));
    const textarea = env.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑评论"]')!;
    textarea.focus();
    await env.type(textarea, "my draft");
    await env.click(env.button("保存"));
    assert.equal(textarea.value, "my draft");
    assert.equal(env.container.querySelector("textarea"), textarea);
    assert.equal(env.button("保存").disabled, true);
    assert.equal(env.container.querySelector('[role="alert"]')!.textContent, "这条评论已经发生变化。载入最新");
    assert.equal(env.requests[1].path, "/diary/diary%2Fa/comments/c-2");
    await env.click(env.button("载入最新"));
    assert.equal(textarea.value, "server latest");
    await env.type(textarea, "after reload");
    await env.click(env.button("保存"));
    assert.deepEqual(JSON.parse(env.requests[0].init!.body as string), { expected_revision: 1, content: "my draft" });
    assert.deepEqual(JSON.parse(env.requests[2].init!.body as string), { expected_revision: 3, content: "after reload" });
    assert.equal(env.container.querySelector("textarea"), null);
    assert.equal(env.container.querySelector(".diary-comment-content")!.textContent, "after reload");
  } finally { await env.cleanup(); }
});

test("mobile delete menu cancellation and successful delete keep canonical metadata", async () => {
  const pending = deferred<unknown>();
  const env = await render(() => pending.promise);
  try {
    const trigger = env.container.querySelector<HTMLButtonElement>('[aria-label="评论操作"]')!;
    await env.click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    let menu = env.container.querySelector(".diary-comment-menu-popover")!;
    await env.click(env.button("删除", menu));
    menu = env.container.querySelector(".diary-comment-menu-popover")!;
    await env.click(env.button("取消", menu));
    assert.equal(env.container.querySelector(".diary-comment-menu-popover"), null);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    await env.click(env.button("删除"));
    await env.click(env.button("确认删除"));
    assert.equal(env.button("删除中…").disabled, true);
    assert.equal(env.requests[0].init?.method, "DELETE");
    assert.deepEqual(JSON.parse(env.requests[0].init!.body as string), { expected_revision: 1 });
    await React.act(async () => pending.resolve(undefined));
    assert.equal(env.container.querySelector("article"), null);
    assert.deepEqual(env.updates[0].metadata, { count: 0, returned: 0, truncated: false });
  } finally { await env.cleanup(); }
});

test("delete conflict reads latest instead of removing the changed comment", async () => {
  const env = await render((_path, init) => {
    if (init?.method === "DELETE") throw new WebApiError(409, "COMMENT_REVISION_CONFLICT", "conflict");
    return { success: true, data: comment("c-2", { revision: 2, content: "changed" }) };
  });
  try {
    await env.click(env.button("删除"));
    await env.click(env.button("确认删除"));
    assert.equal(env.container.querySelector(".diary-comment-content")!.textContent, "changed");
    assert.equal(env.container.querySelector('[role="alert"]')!.textContent, "这条评论已经发生变化，请确认最新内容后再删除。");
    assert.equal(env.updates[0].metadata.count, 1);
    assert.equal(env.requests.length, 2);
  } finally { await env.cleanup(); }
});

test("archived pagination remains GET-only and uses the archived parent route", async () => {
  const env = await render(() => ({ success: true, data: {
    comments: [comment("c-1")], metadata: { count: 2, returned: 1, has_more: false, next_before: null },
  } }), { readOnly: true, metadata: { count: 2, returned: 1, truncated: true } });
  try {
    assert.deepEqual([...env.container.querySelectorAll("button")].map(({ textContent }) => textContent), ["查看更早评论"]);
    await env.click(env.button("查看更早评论"));
    assert.equal(env.requests[0].path, "/diary/archived/diary%2Fa/comments?limit=100");
    assert.equal(env.requests[0].init, undefined);
    assert.equal(env.container.querySelector("button"), null);
  } finally { await env.cleanup(); }
});
