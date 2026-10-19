import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { BrowserRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import { UniversePage } from "../web/src/pages/UniversePage.js";
import { WebApiError } from "../web/src/api/web-api-error.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import type { UniverseReadResult } from "../web/src/pages/universe/universe-types.js";
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const node = { id: "n1", title: "Original node", summary: "summary", content: "body", type: "concept", tags: [], galaxies: [], position: { x: 20, y: 30 }, createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z" };
function data(version = 1, title = node.title): UniverseReadResult {
  return { version, sources: [], snapshot: { schemaVersion: 2, meta: { name: "Synthetic", createdAt: node.createdAt, updatedAt: node.updatedAt }, galaxies: [], nodes: [{ ...node, title }], relations: [], revisions: [] } };
}
async function mount(path = "/universe") {
  const dom = new JSDOM('<main id="root"></main>', { url: `https://leileios.test${path}` });
  const old = new Map<string, PropertyDescriptor | undefined>();
  const frames: Array<FrameRequestCallback> = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement, Node: dom.window.Node,
    React, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (f: FrameRequestCallback) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {} })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { value: function(this: HTMLElement, name: string, listener: EventListener) { this.addEventListener(name.replace(/^on/, ""), listener); }, configurable: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { value: function(this: HTMLElement, name: string, listener: EventListener) { this.removeEventListener(name.replace(/^on/, ""), listener); }, configurable: true });
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
  const calls: Array<{ path: string; init?: RequestInit; reply: ReturnType<typeof deferred> }> = [];
  const makeApi = (): WebApiClient => ({ request<T>(path: string, init?: RequestInit): Promise<T> {
    const reply = deferred(); calls.push({ path, init, reply }); return reply.promise as Promise<T>;
  } });
  let api = makeApi();
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const render = async () => { await React.act(async () => { root.render(React.createElement(BrowserRouter, {}, React.createElement(UniversePage, { api }))); });
    await React.act(async () => { while (frames.length) frames.shift()!(0); }); };
  await render();
  return {
    dom, container, calls,
    async replaceApi() { api = makeApi(); await render(); },
    async settle(index: number, value: UniverseReadResult | Error) { await React.act(async () => {
      const reply = calls[index].reply;
      if (value instanceof Error) reply.reject(value); else reply.resolve({ success: true, data: value });
      await reply.promise.catch(() => undefined);
    }); },
    button(text: string) { const b = [...container.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text); assert.ok(b, `button ${text}`); return b; },
    async click(b: HTMLButtonElement) { await React.act(async () => b.click()); },
    async editTitle(value: string) { const input = container.querySelector<HTMLInputElement>('input[aria-label="星球标题"]')!; assert.ok(input);
      await React.act(async () => { input.focus(); Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        const event = new dom.window.Event("propertychange", { bubbles: true });
        Object.defineProperty(event, "propertyName", { value: "value" }); input.dispatchEvent(event); });
    },
    async cleanup() { await React.act(async () => root.unmount()); dom.window.close();
      for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } },
  };
}

test("mounted Universe load failure retries and obsolete API responses cannot replace the new page", async () => {
  const p = await mount();
  try {
    assert.equal(p.calls[0].path, "/universe");
    await p.settle(0, new Error("private failure"));
    assert.match(p.container.textContent ?? "", /Unable to read Universe/);
    assert.doesNotMatch(p.container.textContent ?? "", /private failure/);
    await p.click(p.button("Retry"));
    await p.replaceApi();
    await p.settle(2, data(2, "Current node"));
    await p.settle(1, data(1, "Obsolete node"));
    assert.ok(p.container.querySelector('button[aria-label="查看节点：Current node"]'));
    assert.equal(p.container.querySelector('button[aria-label="查看节点：Obsolete node"]'), null);
  } finally { await p.cleanup(); }
});

for (const conflict of [false, true]) test(`mounted Universe edit retains draft after ${conflict ? "version conflict" : "network failure"} and protects the next explicit write`, async () => {
  const p = await mount("/universe?node=n1");
  try {
    await p.settle(0, data());
    assert.ok(p.container.querySelector('[role="dialog"]'));
    await p.click(p.button("编辑"));
    await p.editTitle("Unsaved draft");
    await p.click(p.button("保存"));
    assert.equal(p.calls[1].init?.method, "PATCH");
    const submitted = JSON.parse(String(p.calls[1].init?.body));
    assert.equal(submitted.patch.title, "Unsaved draft");
    assert.equal(submitted.expected_version, 1);
    await p.settle(1, conflict ? new WebApiError(409, "VERSION_CONFLICT", "synthetic conflict") : new Error("network lost"));
    assert.equal(p.calls[2].path, "/universe", "failure reconciles canonical state rather than blindly repeating the write");
    const remote = data(2, "Remote title");
    remote.snapshot.nodes[0].content = "Remote body";
    await p.settle(2, remote);
    assert.equal(p.container.querySelector<HTMLInputElement>('input[aria-label="星球标题"]')?.value, "Unsaved draft");
    assert.equal(p.calls.filter(c => c.init?.method === "PATCH").length, 1);
    const savedTitle = "Reviewed draft";
    {
      if (!conflict) await p.click(p.button("保存"));
      assert.equal(p.button("保存").disabled, true, "a stale draft cannot borrow the newly read version");
      await p.click(p.button("保存"));
      assert.equal(p.calls.filter(c => c.init?.method === "PATCH").length, 1);
      await p.click(p.button("取消"));
      await p.click(p.button("编辑"));
      assert.equal(p.container.querySelector<HTMLInputElement>('input[aria-label="星球标题"]')?.value, "Remote title");
      await p.editTitle(savedTitle);
    }
    await p.click(p.button("保存"));
    assert.equal(JSON.parse(String(p.calls[3].init?.body)).expected_version, 2);
    assert.equal(JSON.parse(String(p.calls[3].init?.body)).patch.content, "Remote body");
    await p.settle(3, data(3, savedTitle));
    assert.equal(p.container.querySelector('input[aria-label="星球标题"]'), null);
    assert.match(p.container.querySelector('[role="dialog"]')?.textContent ?? "", new RegExp(savedTitle));
  } finally { await p.cleanup(); }
});

test("mounted Universe cancel edit returns to current detail without writing", async () => {
  const p = await mount("/universe?node=n1");
  try {
    await p.settle(0, data()); await p.click(p.button("编辑")); await p.editTitle("Discard me");
    await p.click(p.button("取消"));
    assert.equal(p.calls.length, 1);
    assert.equal(p.container.querySelector('input[aria-label="星球标题"]'), null);
    assert.match(p.container.querySelector('[role="dialog"]')?.textContent ?? "", /Original node/);
    assert.doesNotMatch(p.container.querySelector('[role="dialog"]')?.textContent ?? "", /Discard me/);
  } finally { await p.cleanup(); }
});

// Reopening before the recovery read returns must not advance the edit baseline.
test("mounted Universe reopen during reconciliation cannot overwrite a remote unedited field", async () => {
  const p = await mount("/universe?node=n1");
  try {
    await p.settle(0, data()); await p.click(p.button("编辑")); await p.editTitle("Local title");
    await p.click(p.button("保存")); await p.settle(1, new Error("lost response"));
    await p.click(p.button("取消")); await p.click(p.button("编辑"));
    const remote = data(2); remote.snapshot.nodes[0].content = "Remote body";
    await p.settle(2, remote);
    await p.click(p.button("保存"));
    assert.equal(p.calls.filter(c => c.init?.method === "PATCH").length, 1);
    assert.equal(p.button("保存").disabled, true);
  } finally { await p.cleanup(); }
});
