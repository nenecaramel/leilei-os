import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  SystemDataPageContent,
} from "../web/src/pages/SystemDataPageContent.js";
import {
  SystemActivityPageContent,
} from "../web/src/pages/SystemActivityPageContent.js";

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
          memory: { active: 12, archived: 3 },
          diary: { active: 8, archived: 2 },
          task: { active: 5, archived: 7 },
          health: { total: 31 },
        },
      } as T;
    },
  };

  root.render(
    React.createElement(SystemDataPageContent, { api }),
  );

  await waitForPaint();

  assert.deepEqual(paths, ["/system/data"]);
  const text = container.textContent ?? "";

  for (const expected of [
    "Memory",
    "12",
    "3",
    "Diary",
    "8",
    "2",
    "Task",
    "5",
    "7",
    "Health",
    "31",
  ]) {
    assert.match(text, new RegExp(expected));
  }

  assert.doesNotMatch(text, /Export|Restore|Backup/i);

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
          memory: { active: 1, archived: 0 },
          diary: { active: 2, archived: 0 },
          task: { active: 3, archived: 0 },
          health: { total: 4 },
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
  assert.match(container.textContent ?? "", /Health/);
  assert.match(container.textContent ?? "", /4/);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Activity groups persisted events by day and keeps newest event first", async () => {
  const env = installDom(
    "https://leilei.test/system/activity",
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
          events: [
            {
              id: "evt-2",
              occurred_at:
                "2026-08-09T07:30:00.000Z",
              label: "Task archived",
              source: "Web",
              outcome: "success",
            },
            {
              id: "evt-1",
              occurred_at:
                "2026-08-08T04:15:00.000Z",
              label: "Memory restored",
              source: "MCP",
              outcome: "success",
            },
          ],
        },
      } as T;
    },
  };

  root.render(
    React.createElement(
      SystemActivityPageContent,
      { api },
    ),
  );

  await waitForPaint();

  assert.deepEqual(paths, ["/system/activity"]);
  const text = container.textContent ?? "";
  assert.match(text, /Task archived/);
  assert.match(text, /Memory restored/);
  assert.match(text, /Web/);
  assert.match(text, /MCP/);
  assert.match(text, /Success/);

  const labels = Array.from(
    container.querySelectorAll(
      ".system-activity-label",
    ),
  ).map((node) => node.textContent);
  assert.deepEqual(
    labels,
    ["Task archived", "Memory restored"],
  );

  assert.equal(
    container.querySelectorAll(
      ".system-activity-day",
    ).length,
    2,
  );

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Activity accepts empty history as a valid ready state", async () => {
  const env = installDom(
    "https://leilei.test/system/activity",
  );
  const container =
    env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  const api: WebApiClient = {
    async request<T>(): Promise<T> {
      return {
        success: true,
        data: {
          events: [],
        },
      } as T;
    },
  };

  root.render(
    React.createElement(
      SystemActivityPageContent,
      { api },
    ),
  );

  await waitForPaint();

  assert.match(
    container.textContent ?? "",
    /No activity yet/,
  );

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Activity exposes Retry after API failure", async () => {
  const env = installDom(
    "https://leilei.test/system/activity",
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
          events: [],
        },
      } as T;
    },
  };

  root.render(
    React.createElement(
      SystemActivityPageContent,
      { api },
    ),
  );

  await waitForPaint();

  assert.match(
    container.textContent ?? "",
    /Unable to read activity/,
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
  assert.match(
    container.textContent ?? "",
    /No activity yet/,
  );

  root.unmount();
  await waitForPaint();
  env.restore();
});
