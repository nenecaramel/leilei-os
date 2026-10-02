import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import {
  SystemAccountPageContent,
} from "../web/src/pages/SystemAccountPage.js";
import {
  SystemConnectionsPageContent,
} from "../web/src/pages/SystemConnectionsPageContent.js";

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://leilei.test/system/account" },
  );
  const previous = new Map<string, PropertyDescriptor | undefined>();

  for (const key of ["window", "document", "navigator", "React"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
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
  new Promise((resolve) => setTimeout(resolve, 30));

test("Account content renders Auth0 identity and signs out through its single action", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let signOutCalls = 0;

  root.render(
    React.createElement(SystemAccountPageContent, {
      name: "Lei",
      email: "lei@example.com",
      onSignOut: () => {
        signOutCalls += 1;
      },
    }),
  );

  await waitForPaint();

  assert.match(container.textContent ?? "", /Account/);
  assert.match(container.textContent ?? "", /Lei/);
  assert.match(container.textContent ?? "", /lei@example\.com/);
  assert.match(container.textContent ?? "", /Signed in with Auth0/);
  assert.equal(container.querySelector(".user-avatar"), null);
  assert.equal(container.querySelector("img"), null);

  const button = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.includes("Sign out"));
  assert.ok(button);
  button.click();
  assert.equal(signOutCalls, 1);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Connections loads the safe status contract from /system/connections", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const paths: string[] = [];

  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      paths.push(path);
      return {
        success: true,
        data: {
          web_api: "online",
          public_mcp: "available",
          internal_mcp: "not_enabled",
        },
      } as T;
    },
  };

  root.render(
    React.createElement(SystemConnectionsPageContent, { api }),
  );

  await waitForPaint();

  assert.deepEqual(paths, ["/system/connections"]);
  const text = container.textContent ?? "";
  assert.match(text, /Web API/);
  assert.match(text, /Online/);
  assert.match(text, /ChatGPT \/ Claude MCP/);
  assert.match(text, /Available/);
  assert.match(text, /Internal MCP/);
  assert.match(text, /Not enabled/);
  assert.equal(container.querySelector('[data-connection-action]'), null);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Connections exposes an explicit retry after API failure", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let attempts = 0;

  const api: WebApiClient = {
    async request<T>(): Promise<T> {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("offline");
      }

      return {
        success: true,
        data: {
          web_api: "online",
          public_mcp: "available",
          internal_mcp: "available",
        },
      } as T;
    },
  };

  root.render(
    React.createElement(SystemConnectionsPageContent, { api }),
  );

  await waitForPaint();
  assert.match(
    container.textContent ?? "",
    /Unable to read connection status/,
  );

  const retry = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((candidate) => candidate.textContent?.includes("Retry"));
  assert.ok(retry);

  retry.click();
  await waitForPaint();

  assert.equal(attempts, 2);
  assert.match(container.textContent ?? "", /Internal MCP/);
  assert.match(container.textContent ?? "", /Available/);

  root.unmount();
  await waitForPaint();
  env.restore();
});
