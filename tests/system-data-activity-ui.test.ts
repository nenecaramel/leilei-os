import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  SystemDataPageContent,
} from "../web/src/pages/SystemDataPageContent.js";
function installDom(url: string) {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url },
  );
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const key of ["window", "document", "navigator", "React"]) {
    previous.set(
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    );
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === "React"
          ? React
          : dom.window[key as keyof Window],
    });
  }

  return {
    dom,
    restore() {
      for (const key of ["window", "document", "navigator", "React"]) {
        const descriptor = previous.get(key);
        if (descriptor) {
          Object.defineProperty(globalThis, key, descriptor);
        } else {
          Reflect.deleteProperty(globalThis, key);
        }
      }
      dom.window.close();
    },
  };
}

const waitForPaint = () =>
  new Promise((resolve) => setTimeout(resolve, 35));

async function waitForCondition(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("Data renders authenticated user-scoped counts from /system/data", async () => {
  const env = installDom(
    "https://leilei.test/system/data",
  );
  const container =
    env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const paths: string[] = [];

  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      paths.push(path);
      return {
        success: true,
        data: {
          diary: { active: 8, archived: 2 },
          todo: { active: 9, count: 9 },
          diary_comments: { count: 1 },
          conversations: { active: 3, archived: 1 },
          mind: { count: 4 },
          universe: { nodes: 5 },
        },
      } as T;
    },
  };

  root.render(
    React.createElement(SystemDataPageContent, { api }),
  );

  await waitForCondition(
    () =>
      paths.includes("/system/data") &&
      /Diary/.test(container.textContent ?? "") &&
      /9/.test(container.textContent ?? ""),
    "System Data request and ready state",
  );

  assert.deepEqual(paths, ["/system/data"]);
  const text = container.textContent ?? "";

  for (const expected of [
    "Diary",
    "8",
    "2",
    "Todo",
    "9",
    "Conversations",
    "Mind",
    "Universe",
  ]) {
    assert.match(text, new RegExp(expected));
  }
  assert.deepEqual(
    Array.from(container.querySelectorAll(".system-data-row > strong"), row => row.textContent),
    ["Diary", "Diary comments", "Todo", "Conversations", "Mind", "Universe"],
  );

  const todoRow = Array.from(container.querySelectorAll(".system-data-row")).find((row) => row.textContent?.includes("Todo"));
  assert.ok(todoRow);
  assert.match(todoRow.textContent ?? "", /9/u);
  assert.doesNotMatch(todoRow.textContent ?? "", /Archived/);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data renders only active modules", async () => {
  const env = installDom("https://leilei.test/system/data");
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  const api: WebApiClient = {
    async request<T>(): Promise<T> {
      return {
        success: true,
        data: {
          diary: { active: 2, archived: 1 },
          todo: { active: 3, count: 3 },
          diary_comments: { count: 1 },
          conversations: { active: 3, archived: 1 },
          mind: { count: 4 },
          universe: { nodes: 5 },
        },
      } as T;
    },
  };

  root.render(React.createElement(SystemDataPageContent, { api }));
  await waitForCondition(
    () => /Diary/.test(container.textContent ?? "") && /Todo/.test(container.textContent ?? ""),
    "active System Data modules to render",
  );

  const text = container.textContent ?? "";
  assert.match(text, /Diary/);
  assert.match(text, /Todo/);
  assert.deepEqual(
    Array.from(container.querySelectorAll(".system-data-row > strong"), row => row.textContent),
    ["Diary", "Diary comments", "Todo", "Conversations", "Mind", "Universe"],
  );

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Data exposes Retry after a failed count request", async () => {
  const env = installDom(
    "https://leilei.test/system/data",
  );
  const container =
    env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let attempts = 0;

  const api: WebApiClient = {
    async request<T>(): Promise<T> {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("unavailable");
      }
      return {
        success: true,
        data: {
          diary: { active: 2, archived: 0 },
          todo: { active: 0, count: 0 },
          diary_comments: { count: 1 },
          conversations: { active: 3, archived: 1 },
          mind: { count: 4 },
          universe: { nodes: 5 },
        },
      } as T;
    },
  };

  root.render(
    React.createElement(SystemDataPageContent, { api }),
  );

  await waitForPaint();
  assert.match(
    container.textContent ?? "",
    /Unable to read data summary/,
  );

  const retry = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) =>
    candidate.textContent?.includes("Retry"),
  );
  assert.ok(retry);

  retry.click();
  await waitForPaint();

  assert.equal(attempts, 2);

  root.unmount();
  await waitForPaint();
  env.restore();
});
