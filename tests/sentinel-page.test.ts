import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import { NavigationGroups } from "../web/src/layout/NavigationGroups.js";
import { WebApiError } from "../web/src/api/web-api-error.js";
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

async function waitForCondition(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await waitForPaint();
  }
  assert.fail(`Timed out waiting for ${label}`);
}

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

  root.render(React.createElement(SentinelPageContent, { api }));
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
  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForCondition(() => container.textContent?.includes("Wake now") === true, "initial Sentinel readback");
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Recovery")));
  root.unmount();
  env.restore();
});

test("Sentinel renders every projected state with user-facing labels", async () => {
  const projections = [
    ["paused", "Paused", false],
    ["processing", "Processing", true],
    ["waiting_for_chatgpt", "Waiting for ChatGPT", true],
    ["sleeping", "Sleeping", true],
    ["waking", "Waking", true],
    ["recovery_required", "Recovery required", true],
  ] as const;
  for (const [status, label, enabled] of projections) {
    const env = installDom();
    const container = env.dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    const api: WebApiClient = {
      request: async (path) => path.includes("wakes")
        ? { success: true, data: { wakes: [] } } as never
        : response({ status, sentinel: { ...response().data.sentinel, enabled } }) as never,
    };
    root.render(React.createElement(SentinelPageContent, { api }));
    await waitForCondition(() => container.textContent?.includes(label) === true, `${status} projection`);
    assert.match(container.textContent ?? "", new RegExp(label));
    if (status !== "recovery_required") {
      assert.equal([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Recovery")), false);
    }
    root.unmount();
    await waitForPaint();
    env.restore();
  }
});

test("Sentinel API failures remain visible and do not fabricate an enabled state", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = {
    request: async () => { throw new Error("private provider failure"); },
  };
  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForCondition(() => container.querySelector('[role="alert"]') !== null, "Sentinel error state");
  assert.match(container.textContent ?? "", /temporarily unavailable/);
  assert.doesNotMatch(container.textContent ?? "", /\bON\b/);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("an uninitialized Sentinel requires policy setup before wake controls become available", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  let saved = false;
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    request: async (path, init) => {
      requests.push({ path, init });
      if (path === "/sentinel/wakes?limit=20") return { success: true, data: { wakes: [] } } as never;
      if (path === "/sentinel" && init?.method === "PUT") {
        saved = true;
        return { success: true, data: { sentinel: { ...response().data.sentinel, enabled: false } } } as never;
      }
      if (path === "/sentinel" && !saved) {
        throw new WebApiError(404, "SENTINEL_NOT_FOUND", "Sentinel was not found.");
      }
      return response({
        sentinel: { ...response().data.sentinel, enabled: false },
        status: "paused",
      }) as never;
    },
  };

  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForCondition(() => container.textContent?.includes("Set up Sentinel") === true, "uninitialized Sentinel setup state");
  assert.match(container.textContent ?? "", /Save a policy to set up your private wake controls/);
  assert.equal(container.querySelector<HTMLInputElement>("input")?.disabled, false);
  assert.equal(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled, false);
  assert.equal([...container.querySelectorAll("button")].some((button) => /^(Resume|Resume now|Wake now|Pause|Recovery)$/.test(button.textContent ?? "")), false);
  assert.doesNotMatch(container.textContent ?? "", /\bON\b/);

  const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save policy");
  assert.ok(save);
  save.click();
  await waitForCondition(() => container.textContent?.includes("Paused") === true, "persisted paused readback");
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent === "Resume"));
  assert.ok([...container.querySelectorAll("button")].some((button) => button.textContent === "Resume now"));
  assert.ok(requests.some(({ path, init }) => path === "/sentinel" && init?.method === "PUT"));
  assert.ok(requests.filter(({ path }) => path === "/sentinel").length >= 3);
  root.unmount();
  await waitForPaint();
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
  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForPaint();
  const pause = [...container.querySelectorAll("button")].find((button) => button.textContent === "Pause");
  assert.ok(pause);
  pause?.click();
  await waitForCondition(() => container.textContent?.includes("Paused") === true, "authoritative paused readback");
  await waitForCondition(() => container.querySelector(".sentinel-page")?.getAttribute("aria-busy") === "false", "pause action completion");
  assert.match(container.textContent ?? "", /Paused/);
  assert.ok(paths.includes("POST /sentinel/pause"));
  assert.ok(paths.filter((path) => path === "GET /sentinel").length >= 2);
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Sentinel policy draft is sent through the authenticated API contract", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const requests: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    request: async (path, init) => {
      requests.push({ path, init });
      if (path === "/sentinel/wakes?limit=20") return { success: true, data: { wakes: [] } } as never;
      return response() as never;
    },
  };
  root.render(React.createElement(SentinelPageContent, { api }));
  await waitForCondition(() => container.textContent?.includes("Wake now") === true, "initial Sentinel readback");
  const policy = container.querySelector<HTMLTextAreaElement>("textarea");
  assert.ok(policy);
  assert.equal(policy.value, "Keep a gentle eye on my workspace.");
  container.querySelector<HTMLButtonElement>("button")?.click();
  await waitForCondition(() => requests.some(({ path, init }) => path === "/sentinel" && init?.method === "PUT"), "policy save request");
  const save = requests.find(({ path, init }) => path === "/sentinel" && init?.method === "PUT");
  assert.deepEqual(JSON.parse(String(save?.init?.body)), {
    timezone: "Asia/Shanghai",
    policyPrompt: "Keep a gentle eye on my workspace.",
  });
  root.unmount();
  await waitForPaint();
  env.restore();
});

test("Sentinel route and navigation entry are wired", () => {
  const appSource = readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
  const navSource = readFileSync(new URL("../web/src/layout/NavigationGroups.tsx", import.meta.url), "utf8");
  assert.match(appSource, /path="sentinel"/);
  assert.match(navSource, /to:\s*["']\/sentinel["']/);
});
