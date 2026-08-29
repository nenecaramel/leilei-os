import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";

test("System Connections bridge entry is bounded and sends only text", () => {
  const source = readFileSync("web/src/pages/SystemConnectionsPageContent.tsx", "utf8");
  assert.match(source, /maxLength=\{4000\}/);
  assert.match(source, /JSON\.stringify\(\{ text \}\)/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /\/bridge\/events/);
  assert.doesNotMatch(source, /localStorage/);
});

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://leilei.test/system/connections" },
  );
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLTextAreaElement",
    "Node",
    "Event",
    "MouseEvent",
    "React",
  ]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "React" ? React : dom.window[key as keyof Window],
    });
  }
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
  });
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  (dom.window.HTMLElement.prototype as unknown as { attachEvent(name: string, listener: EventListener): void }).attachEvent = function (name, listener) {
    this.addEventListener(name.replace(/^on/, ""), listener);
  };
  (dom.window.HTMLElement.prototype as unknown as { detachEvent(name: string, listener: EventListener): void }).detachEvent = function (name, listener) {
    this.removeEventListener(name.replace(/^on/, ""), listener);
  };
  return {
    dom,
    restore() {
      for (const key of [
        "window",
        "document",
        "navigator",
        "HTMLElement",
        "HTMLTextAreaElement",
        "Node",
        "Event",
        "MouseEvent",
        "React",
      ]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      if (previousCrypto) Object.defineProperty(globalThis, "crypto", previousCrypto);
      else Reflect.deleteProperty(globalThis, "crypto");
      if (previousAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousAct);
      else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
      dom.window.close();
    },
  };
}

function setTextValue(element: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value);
  const change = new element.ownerDocument.defaultView!.Event("propertychange", { bubbles: true });
  Object.defineProperty(change, "propertyName", { value: "value" });
  element.dispatchEvent(change);
  element.dispatchEvent(new element.ownerDocument.defaultView!.Event("input", { bubbles: true }));
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function connectionResponse() {
  return {
    success: true as const,
    data: { web_api: "online" as const, public_mcp: "available" as const, internal_mcp: "available" as const },
  };
}

test("mounted bridge sender posts only text, shows status, and polls owner-scoped receipt", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const { SystemConnectionsPageContent } = await import("../web/src/pages/SystemConnectionsPageContent.js");
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (path === "/system/connections") return connectionResponse() as T;
      if (path === "/bridge/events") {
        return { success: true, data: { id: "bridge-1", status: "pending", createdAt: "2026-08-28T00:00:00.000Z", processingStatus: "unclaimed", modelClaimedAt: null, modelCompletedAt: null, deliveryReconciledAt: null } } as T;
      }
      return { success: true, data: { id: "bridge-1", status: "host_sent", createdAt: "2026-08-28T00:00:00.000Z", processingStatus: "completed", modelClaimedAt: "2026-08-28T00:01:00.000Z", modelCompletedAt: "2026-08-28T00:02:00.000Z", deliveryReconciledAt: null } } as T;
    },
  };

  await React.act(async () => root.render(React.createElement(SystemConnectionsPageContent, { api })));
  await waitFor(() => container.querySelector("textarea") !== null, "bridge form");
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  const send = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Send")!;
  assert.equal(send.disabled, true);
  await React.act(async () => {
    textarea.focus();
    setTextValue(textarea, "hello");
  });
  await waitFor(() => !send.disabled, "enabled send action");
  await React.act(async () => send.click());
  await waitFor(() => container.textContent?.includes("Sent to ChatGPT") === true, "sent status");

  const post = calls.find((call) => call.path === "/bridge/events");
  assert.ok(post);
  assert.deepEqual(JSON.parse(String(post.init?.body)), { text: "hello" });
  assert.equal(new Headers(post.init?.headers).get("Idempotency-Key"), "00000000-0000-4000-8000-000000000001");
  assert.equal(container.textContent?.includes("reply"), false);
  assert.equal(calls.some((call) => call.path === "/bridge/events/bridge-1"), true);

  root.unmount();
  await new Promise((resolve) => setTimeout(resolve, 30));
  env.restore();
});

test("mounted bridge retry preserves the same idempotency key after an ambiguous create failure", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const { SystemConnectionsPageContent } = await import("../web/src/pages/SystemConnectionsPageContent.js");
  const keys: string[] = [];
  let posts = 0;
  const api: WebApiClient = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      if (path === "/system/connections") return connectionResponse() as T;
      if (path === "/bridge/events") {
        keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
        posts += 1;
        if (posts === 1) throw new Error("network timeout");
        return { success: true, data: { id: "bridge-2", status: "pending", createdAt: "2026-08-28T00:00:00.000Z", processingStatus: "unclaimed", modelClaimedAt: null, modelCompletedAt: null, deliveryReconciledAt: null } } as T;
      }
      return { success: true, data: { id: "bridge-2", status: "pending", createdAt: "2026-08-28T00:00:00.000Z", processingStatus: "unclaimed", modelClaimedAt: null, modelCompletedAt: null, deliveryReconciledAt: null } } as T;
    },
  };

  await React.act(async () => root.render(React.createElement(SystemConnectionsPageContent, { api })));
  await waitFor(() => container.querySelector("textarea") !== null, "bridge form");
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await React.act(async () => {
    textarea.focus();
    setTextValue(textarea, "retry me");
  });
  const send = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Send")!;
  await waitFor(() => !send.disabled, "enabled send action");
  await React.act(async () => send.click());
  await waitFor(() => container.textContent?.includes("Unable to send the message") === true, "send error");
  await React.act(async () => send.click());
  await waitFor(() => posts === 2 && container.textContent?.includes("Queued") === true, "retry receipt");
  assert.equal(keys[0], keys[1]);

  root.unmount();
  await new Promise((resolve) => setTimeout(resolve, 30));
  env.restore();
});

test("mounted bridge polling continues after transport terminality until processing completes", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const { SystemConnectionsPageContent } = await import("../web/src/pages/SystemConnectionsPageContent.js");
  let reads = 0;
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/connections") return connectionResponse() as T;
      if (path === "/bridge/events") return { success: true, data: { id: "bridge-3", status: "host_sent", createdAt: "2026-08-28T00:00:00.000Z", processingStatus: "unclaimed", modelClaimedAt: null, modelCompletedAt: null, deliveryReconciledAt: null } } as T;
      reads += 1;
      return { success: true, data: { id: "bridge-3", status: "host_sent", createdAt: "2026-08-28T00:00:00.000Z", processingStatus: "completed", modelClaimedAt: "2026-08-28T00:01:00.000Z", modelCompletedAt: "2026-08-28T00:02:00.000Z", deliveryReconciledAt: null } } as T;
    },
  };
  await React.act(async () => root.render(React.createElement(SystemConnectionsPageContent, { api })));
  await waitFor(() => container.querySelector("textarea") !== null, "bridge form");
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await React.act(async () => { textarea.focus(); setTextValue(textarea, "hello"); });
  const send = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Send")!;
  await waitFor(() => !send.disabled, "enabled send action");
  await React.act(async () => send.click());
  await waitFor(() => reads > 0 && container.textContent?.includes("Processing completed") === true, "processing completion");
  root.unmount();
  await new Promise((resolve) => setTimeout(resolve, 30));
  env.restore();
});

test("mounted bridge polling continues when processing completes before transport terminality", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const { SystemConnectionsPageContent } = await import("../web/src/pages/SystemConnectionsPageContent.js");
  let reads = 0;
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/connections") return connectionResponse() as T;
      if (path === "/bridge/events") {
        return { success: true, data: { id: "bridge-race", status: "reserved", createdAt: "2026-08-28T00:00:00.000Z", processingStatus: "completed", modelClaimedAt: "2026-08-28T00:01:00.000Z", modelCompletedAt: "2026-08-28T00:02:00.000Z", deliveryReconciledAt: null } } as T;
      }
      reads += 1;
      return { success: true, data: { id: "bridge-race", status: "host_sent", createdAt: "2026-08-28T00:00:00.000Z", processingStatus: "completed", modelClaimedAt: "2026-08-28T00:01:00.000Z", modelCompletedAt: "2026-08-28T00:02:00.000Z", deliveryReconciledAt: null } } as T;
    },
  };

  await React.act(async () => root.render(React.createElement(SystemConnectionsPageContent, { api })));
  await waitFor(() => container.querySelector("textarea") !== null, "bridge form");
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await React.act(async () => { textarea.focus(); setTextValue(textarea, "hello"); });
  const send = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Send")!;
  await waitFor(() => !send.disabled, "enabled send action");
  await React.act(async () => send.click());
  await waitFor(() => reads > 0 && container.textContent?.includes("Sent to ChatGPT") === true, "transport completion after model completion");

  root.unmount();
  await new Promise((resolve) => setTimeout(resolve, 30));
  env.restore();
});

test("mounted bridge status keeps delivery uncertainty visible when later model evidence reconciles it", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const { SystemConnectionsPageContent } = await import("../web/src/pages/SystemConnectionsPageContent.js");
  const api: WebApiClient = {
    async request<T>(path: string): Promise<T> {
      if (path === "/system/connections") return connectionResponse() as T;
      return {
        success: true,
        data: {
          id: "bridge-reconciled",
          status: "delivery_unknown",
          createdAt: "2026-08-28T00:00:00.000Z",
          processingStatus: "completed",
          modelClaimedAt: "2026-08-28T00:01:00.000Z",
          modelCompletedAt: "2026-08-28T00:02:00.000Z",
          deliveryReconciledAt: "2026-08-28T00:01:00.000Z",
        },
      } as T;
    },
  };

  await React.act(async () => root.render(React.createElement(SystemConnectionsPageContent, { api })));
  await waitFor(() => container.querySelector("textarea") !== null, "bridge form");
  const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
  await React.act(async () => { textarea.focus(); setTextValue(textarea, "hello"); });
  const send = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Send")!;
  await waitFor(() => !send.disabled, "enabled send action");
  await React.act(async () => send.click());
  await waitFor(() => container.textContent?.includes("Later confirmed") === true, "reconciled status");
  assert.match(container.textContent ?? "", /Delivery uncertain — do not resend/);
  assert.match(container.textContent ?? "", /Processing completed/);

  root.unmount();
  await new Promise((resolve) => setTimeout(resolve, 30));
  env.restore();
});
