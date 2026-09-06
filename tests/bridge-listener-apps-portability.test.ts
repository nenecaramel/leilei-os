import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import {
  BRIDGE_RESOURCE_URI,
  createBridgeListenerHtml,
  registerBridgeListenerResource,
} from "../src/mcp/tools/bridge-listener/listener-resource.js";

type JsonRpcMessage = {
  id?: number;
  jsonrpc: string;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown>; [key: string]: unknown };
  result?: unknown;
};

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createHost(capabilities: Record<string, unknown> = {
  serverTools: {},
  updateModelContext: { text: {} },
  message: { text: {} },
}): { dom: JSDOM; messages: JsonRpcMessage[] } {
  const messages: JsonRpcMessage[] = [];
  let dom: JSDOM;
  dom = new JSDOM(createBridgeListenerHtml(), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      class ResizeObserverMock {
        observe(): void {}
        disconnect(): void {}
      }
      Object.defineProperty(window, "ResizeObserver", { value: ResizeObserverMock });
      Object.defineProperty(window, "parent", {
        value: {
          postMessage(message: JsonRpcMessage) {
            messages.push(message);
            if (message.method === "ui/initialize") {
              queueMicrotask(() => {
                dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
                  data: {
                    jsonrpc: "2.0",
                    id: message.id,
                    result: {
                      protocolVersion: "host-negotiated",
                      hostCapabilities: capabilities,
                      hostInfo: { name: "Test Host", version: "1.0.0" },
                      hostContext: {},
                    },
                  },
                  source: dom.window.parent,
                }));
              });
            }
          },
        },
      });
    },
  });
  return { dom, messages };
}

function respond(dom: JSDOM, message: JsonRpcMessage, result: unknown): void {
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    data: { jsonrpc: "2.0", id: message.id, result },
    source: dom.window.parent,
  }));
}

function toolResult(data: Record<string, unknown> = {}): Record<string, unknown> {
  return { structuredContent: { success: true, data } };
}

test("Bridge resource serves the official browser bundle without bare imports or source maps", () => {
  const html = createBridgeListenerHtml();
  const browserSource = readFileSync("src/mcp/tools/bridge-listener/browser-runtime.ts", "utf8");
  assert.match(browserSource, /from\s+["']@modelcontextprotocol\/ext-apps["']/);
  assert.doesNotMatch(html, /from\s+["']@modelcontextprotocol\//);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /sourceMappingURL/);
  assert.doesNotMatch(browserSource, /protocolVersion\s*:/);
  assert.match(browserSource, /new App\(/);
  assert.match(browserSource, /new PostMessageTransport\(/);
});

test("Bridge resource registration keeps the MCP App MIME type and minimal CSP metadata", async () => {
  assert.equal(BRIDGE_RESOURCE_URI, "ui://leileios/message-bridge/v4");
  const registrations: Array<{ config: Record<string, unknown>; read: (...args: unknown[]) => Promise<unknown> }> = [];
  const server = {
    registerResource: (...args: unknown[]) => {
      registrations.push({ config: args[2] as Record<string, unknown>, read: args[3] as (...args: unknown[]) => Promise<unknown> });
      return {};
    },
  };
  registerBridgeListenerResource(server as never);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0]!.config.mimeType, RESOURCE_MIME_TYPE);
  assert.deepEqual((registrations[0]!.config._meta as { ui: { csp: Record<string, unknown> } }).ui.csp, { connectDomains: [], resourceDomains: [] });
  const result = await registrations[0]!.read({ uri: BRIDGE_RESOURCE_URI }, {});
  const content = (result as { contents: Array<{ uri: string; mimeType: string; text: string }> }).contents[0]!;
  assert.equal(content.uri, BRIDGE_RESOURCE_URI);
  assert.equal(content.mimeType, RESOURCE_MIME_TYPE);
  assert.match(content.text, /data-bridge-start/);
  assert.doesNotMatch(content.text, /from\s+["']@modelcontextprotocol\//);
});

test("Bridge App connects immediately, auto-resizes, and keeps Bridge Start manual", async () => {
  const { dom, messages } = createHost();
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    assert.equal(messages[0]?.method, "ui/initialize");
    assert.equal(messages[1]?.method, "ui/notifications/initialized");
    assert.equal(messages.some((message) => message.params?.name?.startsWith("bridge_listener_")), false);
    assert.equal(messages.some((message) => message.method === "ui/notifications/size-changed"), true);

    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]");
    assert.ok(start);
    start.click();
    await tick();
    const startCall = messages.find((message) => message.params?.name === "bridge_listener_start");
    assert.ok(startCall);
    assert.equal((startCall.params?.arguments as { listenerInstanceId?: string } | undefined)?.listenerInstanceId?.length, 36);
    respond(dom, startCall, { structuredContent: { success: true, data: { state: "acquired" } } });
  } finally {
    dom.window.close();
  }
});

test("Bridge Start is disabled when required host capabilities are missing", async () => {
  const { dom, messages } = createHost({ serverTools: {} });
  try {
    await tick();
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]");
    const status = dom.window.document.querySelector<HTMLElement>("[data-bridge-status]");
    assert.ok(start);
    assert.ok(status);
    assert.equal(start.disabled, true);
    assert.match(status.textContent ?? "", /Unsupported/);
    assert.equal(messages.some((message) => message.params?.name === "bridge_listener_start"), false);
    assert.equal(messages.some((message) => message.params?.name === "bridge_listener_sync"), false);
    assert.equal(messages.some((message) => message.params?.name === "bridge_listener_delivered"), false);
  } finally {
    dom.window.close();
  }
});

test("Bridge teardown releases a reserved event before sendMessage and returns the standard teardown result", async () => {
  const { dom, messages } = createHost();
  const event = { id: "00000000-0000-4000-8000-000000000099", visibleText: "teardown me", modelContext: "route" };
  try {
    await tick();
    dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!.click();
    await tick();
    const startCall = messages.find((message) => message.params?.name === "bridge_listener_start");
    assert.ok(startCall);
    respond(dom, startCall, toolResult({ state: "acquired" }));
    await tick();
    const syncCall = messages.find((message) => message.params?.name === "bridge_listener_sync");
    assert.ok(syncCall);
    respond(dom, syncCall, { ...toolResult({ event }), _meta: { bridgeEvent: event } });
    await tick();
    const contextCall = messages.find((message) => message.method === "ui/update-model-context");
    assert.ok(contextCall);

    const teardownId = 900;
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { jsonrpc: "2.0", id: teardownId, method: "ui/resource-teardown", params: {} },
      source: dom.window.parent,
    }));
    await tick();

    const release = messages.find((message) => message.params?.name === "bridge_listener_release");
    assert.ok(release);
    assert.equal(messages.some((message) => message.method === "ui/message"), false);
    respond(dom, release, toolResult({}));
    await tick();
    const stop = messages.find((message) => message.params?.name === "bridge_listener_stop");
    assert.ok(stop);
    respond(dom, stop, toolResult({ stopped: true }));
    await tick();

    const teardownResponse = messages.find((message) => message.id === teardownId && message.method === undefined);
    assert.equal(JSON.stringify(teardownResponse?.result), "{}");
    assert.equal(messages.some((message) => message.params?.name === "bridge_listener_delivered"), false);
  } finally {
    dom.window.close();
  }
});

test("Bridge teardown waits for a pending sync and releases the event it reserves", async () => {
  const { dom, messages } = createHost();
  const event = { id: "00000000-0000-4000-8000-000000000100", visibleText: "late sync", modelContext: "route" };
  try {
    await tick();
    dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!.click();
    await tick();
    const startCall = messages.find((message) => message.params?.name === "bridge_listener_start");
    assert.ok(startCall);
    respond(dom, startCall, toolResult({ state: "acquired" }));
    await tick();
    const syncCall = messages.find((message) => message.params?.name === "bridge_listener_sync");
    assert.ok(syncCall);

    const teardownId = 901;
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { jsonrpc: "2.0", id: teardownId, method: "ui/resource-teardown", params: {} },
      source: dom.window.parent,
    }));
    await tick();

    assert.equal(messages.some((message) => message.id === teardownId && message.method === undefined), false);

    respond(dom, syncCall, { ...toolResult({ event }), _meta: { bridgeEvent: event } });
    await tick();

    const release = messages.find((message) => message.params?.name === "bridge_listener_release");
    assert.ok(release);
    assert.equal((release.params?.arguments as { eventId?: string } | undefined)?.eventId, event.id);
    assert.equal(messages.some((message) => message.method === "ui/message"), false);
    assert.equal(messages.some((message) => message.params?.name === "bridge_listener_delivered"), false);
    respond(dom, release, toolResult({}));
    await tick();

    const stop = messages.find((message) => message.params?.name === "bridge_listener_stop");
    assert.ok(stop);
    respond(dom, stop, toolResult({ stopped: true }));
    await tick();

    const teardownResponse = messages.find((message) => message.id === teardownId && message.method === undefined);
    assert.equal(JSON.stringify(teardownResponse?.result), "{}");
  } finally {
    dom.window.close();
  }
});
