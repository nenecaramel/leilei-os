import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import { MemoryRouter } from "../web/node_modules/react-router-dom/dist/index.mjs";
import test from "node:test";
import { NavigationGroups } from "../web/src/layout/NavigationGroups.js";
import { SentinelPageContent } from "../web/src/pages/SentinelPage.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://leilei.test/sentinel",
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "React"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "React" ? React : dom.window[key as keyof Window],
    });
  }
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
  return {
    dom,
    restore() {
      for (const key of ["window", "document", "navigator", "React"]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 20));

function response(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      sentinel: {
        id: "sentinel-id",
        enabled: true,
        timezone: "Asia/Shanghai",
        policyPrompt: "Keep a gentle eye on my workspace.",
        nextWakeAt: "2026-08-30T04:30:00.000Z",
        lastValidWakeAt: "2026-08-30T02:15:00.000Z",
        controlRevision: 3,
      },
      status: "sleeping",
      ...overrides,
    },
  };
}

test("Sentinel page renders owner status, controls, policy, and bounded activity without chat internals", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = {
    request: async (path) => {
      if (path === "/sentinel/wakes?limit=20") {
        return {
          success: true,
          data: {
            wakes: [
              { id: "wake-1", cause: "scheduled", state: "finalized", decision: "quiet", scheduledFor: "2026-08-30T02:15:00.000Z", nextWakeAt: "2026-08-30T04:30:00.000Z", finalizedAt: "2026-08-30T02:15:04.000Z", createdAt: "2026-08-30T02:15:00.000Z", recoveryRequired: false },
            ],
          },
        };
      }
      return response() as never;
    },
  };

  root.render(React.createElement(MemoryRouter, null, React.createElement(SentinelPageContent, { api })));
  await waitForPaint();

  assert.match(container.textContent ?? "", /Autonomous Wake/);
  assert.match(container.textContent ?? "", /ON/);
  assert.match(container.textContent ?? "", /Next wake/);
  assert.match(container.textContent ?? "", /Last valid wake/);
  assert.match(container.textContent ?? "", /Sleeping/);
  assert.match(container.textContent ?? "", /Wake now/);
  assert.match(container.textContent ?? "", /Pause/);
  assert.match(container.textContent ?? "", /Keep a gentle eye/);
  assert.match(container.textContent ?? "", /Wake Activity/);
  assert.doesNotMatch(container.textContent ?? "", /processing_state|delivery_unknown|bridge_event_id|chat composer|transcript/i);
  assert.equal(container.querySelector("textarea")?.value, "Keep a gentle eye on my workspace.");

  root.unmount();
  env.restore();
});

test("Sentinel recovery control appears only for recovery-required projection", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = {
    request: async () => response({ status: "recovery_required" }) as never,
  };
  root.render(React.createElement(MemoryRouter, null, React.createElement(SentinelPageContent, { api })));
  await waitForPaint();
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Recovery")));
  root.unmount();
  env.restore();
});

test("Sentinel controls refresh authoritative state after mutation", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let enabled = true;
  const paths: string[] = [];
  const api: WebApiClient = {
    request: async (path, init) => {
      paths.push(`${init?.method ?? "GET"} ${path}`);
      if (path === "/sentinel/wakes?limit=20") return { success: true, data: { wakes: [] } } as never;
      if (init?.method === "POST" && path === "/sentinel/pause") enabled = false;
      return response({
        sentinel: { ...response().data.sentinel, enabled },
        status: enabled ? "sleeping" : "paused",
      }) as never;
    },
  };
  root.render(React.createElement(MemoryRouter, null, React.createElement(SentinelPageContent, { api })));
  await waitForPaint();
  const pause = [...container.querySelectorAll("button")].find((button) => button.textContent === "Pause");
  assert.ok(pause);
  pause?.dispatchEvent(new env.dom.window.MouseEvent("click", { bubbles: true }));
  await waitForPaint();
  assert.match(container.textContent ?? "", /Paused/);
  assert.ok(paths.includes("POST /sentinel/pause"));
  assert.ok(paths.filter((path) => path === "GET /sentinel").length >= 2);
  root.unmount();
  env.restore();
});

test("Sentinel route and navigation entry are wired", () => {
  const appSource = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
  const navSource = readFileSync(new URL("../web/src/layout/NavigationGroups.tsx", import.meta.url), "utf8");
  assert.match(appSource, /path="sentinel"/);
  assert.match(navSource, /to:\s*["']\/sentinel["']/);
});
