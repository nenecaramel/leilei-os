import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import { UniverseImportFlow } from "../web/src/pages/universe/UniverseImportFlow..js";
import type { UniverseReadResult, UniverseSnapshot } from "../web/src/pages/universe/universe-types.js";
import type { UniverseService } from "../web/src/pages/universe/universe-service.js";

const snapshot: UniverseSnapshot = {
  schemaVersion: 2,
  meta: { name: "Universe", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z" },
  galaxies: [{ id: "g-a", title: "A", description: "", color: "#fff", order: 0 }],
  nodes: [],
  relations: [],
  revisions: [],
};
const sourceJson = JSON.stringify({ ...snapshot, edges: snapshot.relations });

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "https://leilei.test/universe" });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "React"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value: key === "React" ? React : dom.window[key as keyof Window] });
  }
  previous.set("IS_REACT_ACT_ENVIRONMENT", Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT"));
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return {
    dom,
    container: dom.window.document.getElementById("root")!,
    restore() {
      for (const key of ["window", "document", "navigator", "React"]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      const actDescriptor = previous.get("IS_REACT_ACT_ENVIRONMENT");
      if (actDescriptor) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actDescriptor);
      else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      dom.window.close();
    },
  };
}

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 25));

async function render(service: Pick<UniverseService, "initializeUniverse">, callbacks: { onReady?: (state: UniverseReadResult, message: string) => void; onRecheck?: () => void } = {}) {
  const env = installDom();
  const root = createRoot(env.container);
  await React.act(async () => {
    root.render(React.createElement(UniverseImportFlow, {
      service,
      onReady: callbacks.onReady ?? (() => {}),
      onRecheck: callbacks.onRecheck ?? (() => {}),
    }));
  });
  return { ...env, root };
}

function file(env: ReturnType<typeof installDom>, text: string, name = "universe.json") {
  const value = new env.dom.window.File([text], name, { type: "application/json" });
  Object.defineProperty(value, "text", { configurable: true, value: async () => text });
  return value;
}

async function selectFile(container: HTMLElement, selected: File): Promise<void> {
  const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { configurable: true, value: [selected] });
  await React.act(async () => {
    input.dispatchEvent(new input.ownerDocument.defaultView!.Event("change", { bubbles: true }));
  });
  await waitForPaint();
}

async function click(button: HTMLButtonElement): Promise<void> {
  await React.act(async () => { button.click(); });
  await waitForPaint();
}

test("initial importer shows empty copy and only the select action", async () => {
  const env = await render({ initializeUniverse: async () => ({ state: { snapshot, version: 1 }, writeFailed: false }) });
  assert.match(env.container.textContent ?? "", /Universe 还没有内容/);
  assert.equal(env.container.querySelectorAll("button").length, 1);
  assert.equal(env.container.textContent?.includes("确认迁移"), false);
  await React.act(async () => env.root.unmount());
  await waitForPaint();
  env.restore();
});

test("valid file preview shows filename, counts, confirm, and one reselect action", async () => {
  const env = await render({ initializeUniverse: async () => ({ state: { snapshot, version: 1 }, writeFailed: false }) });
  await selectFile(env.container, file(env, sourceJson, "old-universe.json"));
  assert.match(env.container.textContent ?? "", /old-universe\.json/);
  assert.match(env.container.textContent ?? "", /1 星系 · 0 星球 · 0 连接 · 0 历史版本/);
  assert.match(env.container.textContent ?? "", /edges → relations/);
  const buttons = Array.from(env.container.querySelectorAll<HTMLButtonElement>("button"));
  assert.deepEqual(buttons.map((button) => button.textContent), ["确认迁移", "重新选择"]);

  const input = env.container.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "value", { configurable: true, writable: true, value: "stale-selection" });
  let pickerClicks = 0;
  Object.defineProperty(input, "click", { configurable: true, value: () => { pickerClicks += 1; } });
  await click(buttons[1]!);
  assert.equal(input.value, "");
  assert.equal(pickerClicks, 1);

  await React.act(async () => env.root.unmount());
  await waitForPaint();
  env.restore();
});

test("invalid JSON shows a safe error and never enables confirm", async () => {
  const env = await render({ initializeUniverse: async () => ({ state: { snapshot, version: 1 }, writeFailed: false }) });
  await selectFile(env.container, file(env, "not json", "broken.json"));
  assert.match(env.container.textContent ?? "", /文件无法用于迁移/);
  assert.equal(Array.from(env.container.querySelectorAll("button")).some((button) => button.textContent === "确认迁移"), false);
  await React.act(async () => env.root.unmount());
  await waitForPaint();
  env.restore();
});

test("confirm initializes once and reports matching or changed readback", async () => {
  let calls = 0;
  const ready: Array<{ state: UniverseReadResult; message: string }> = [];
  const env = await render({ initializeUniverse: async (value: UniverseSnapshot) => { calls += 1; return { state: { snapshot: value, version: 1 }, writeFailed: false }; } }, { onReady: (state, message) => ready.push({ state, message }) });
  await selectFile(env.container, file(env, sourceJson));
  await click(env.container.querySelector<HTMLButtonElement>("button[data-action='confirm-import']")!);
  assert.equal(calls, 1);
  assert.equal(ready[0]?.message, "Universe 迁移完成。");
  await React.act(async () => env.root.unmount());
  await waitForPaint();
  env.restore();

  const changed = { ...snapshot, galaxies: [{ ...snapshot.galaxies[0]!, title: "Existing" }] };
  const secondReady: string[] = [];
  const second = await render({ initializeUniverse: async () => ({ state: { snapshot: changed, version: 4 }, writeFailed: true }) }, { onReady: (_state, message) => secondReady.push(message) });
  await selectFile(second.container, file(second, sourceJson));
  await click(second.container.querySelector<HTMLButtonElement>("button[data-action='confirm-import']")!);
  assert.deepEqual(secondReady, ["Universe 已存在或状态已变化，未覆盖现有内容。"]);
  await React.act(async () => second.root.unmount());
  await waitForPaint();
  second.restore();
});

test("not-written allows explicit retry while uncertain disables confirm and offers GET-only recheck", async () => {
  let mode: "not-written" | "uncertain" = "not-written";
  let calls = 0;
  const onRecheckCalls: number[] = [];
  const env = await render({ initializeUniverse: async () => {
    calls += 1;
    const error = Object.assign(new Error(mode), { code: mode === "not-written" ? "UNIVERSE_IMPORT_NOT_WRITTEN" : "UNIVERSE_IMPORT_UNCERTAIN" });
    throw error;
  } }, { onRecheck: () => onRecheckCalls.push(1) });
  await selectFile(env.container, file(env, sourceJson));
  const confirm = () => click(env.container.querySelector<HTMLButtonElement>("button[data-action='confirm-import']")!);
  await confirm();
  assert.match(env.container.textContent ?? "", /迁移未写入，可以重新确认/);
  assert.equal(env.container.querySelector<HTMLButtonElement>("button[data-action='confirm-import']")?.disabled, false);
  mode = "uncertain";
  await confirm();
  assert.match(env.container.textContent ?? "", /迁移状态暂时无法确认，请先重新读取；不要再次提交/);
  assert.equal(env.container.querySelector<HTMLButtonElement>("button[data-action='confirm-import']"), null);
  await click(env.container.querySelector<HTMLButtonElement>("button[data-action='recheck-import']")!);
  assert.deepEqual(onRecheckCalls, [1]);
  assert.equal(calls, 2);
  await React.act(async () => env.root.unmount());
  await waitForPaint();
  env.restore();
});

test("existing server content blocks confirmation and offers GET-only recheck", async () => {
  const env = await render({ initializeUniverse: async () => { throw new (class extends Error { readonly code = "UNIVERSE_IMPORT_ALREADY_INITIALIZED"; })(); } });
  await selectFile(env.container, file(env, sourceJson));
  await click(env.container.querySelector<HTMLButtonElement>("button[data-action='confirm-import']")!);
  assert.match(env.container.textContent ?? "", /已有内容/);
  assert.equal(env.container.querySelector<HTMLButtonElement>("button[data-action='confirm-import']"), null);
  assert.ok(env.container.querySelector<HTMLButtonElement>("button[data-action='recheck-import']"));
  await React.act(async () => env.root.unmount());
  await waitForPaint();
  env.restore();
});
