import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createBridgeListenerHtml } from "../src/mcp/tools/bridge-listener/listener-resource.js";

type BridgeCall = {
  id?: number;
  jsonrpc: string;
  method: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    [key: string]: unknown;
  };
};

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function respond(dom: JSDOM, request: BridgeCall, result: unknown): void {
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    data: { jsonrpc: "2.0", id: request.id, result },
    source: dom.window.parent,
  }));
}

test("bridge listener reuses one iframe-owned listenerInstanceId across bridge tool calls", async () => {
  const calls: BridgeCall[] = [];
  const expectedListenerInstanceId = "11111111-1111-4111-8111-111111111111";
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
      Object.defineProperty(window.crypto, "randomUUID", {
        configurable: true,
        value: () => expectedListenerInstanceId,
      });
      Object.defineProperty(window, "parent", {
        value: {
          postMessage(message: BridgeCall) {
            calls.push(message);
            if (message.method === "ui/initialize") {
              queueMicrotask(() => {
                dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
                  data: {
                    jsonrpc: "2.0",
                    id: message.id,
                    result: {
                      protocolVersion: "2026-01-26",
                      hostCapabilities: { serverTools: {}, updateModelContext: { text: {} }, message: { text: {} } },
                      hostInfo: { name: "Test Host", version: "1.0.0" },
                      hostContext: {},
                    },
                  },
                  source: window.parent,
                }));
              });
            }
          },
        },
      });
    },
  });

  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]");
    assert.ok(start);
    await tick();
    assert.equal(calls[0]?.method, "ui/initialize");
    assert.equal(calls[1]?.method, "ui/notifications/initialized");

    start.click();
    await tick();

    const startCall = calls.find((call) => call.params?.name === "bridge_listener_start");
    assert.ok(startCall);
    assert.equal(startCall.params?.arguments?.listenerInstanceId, expectedListenerInstanceId);

    respond(dom, startCall, {
      structuredContent: { success: true, data: { state: "running" } },
    });
    await tick();

    const syncCall = calls.find((call) => call.params?.name === "bridge_listener_sync");
    assert.ok(syncCall);
    assert.equal(syncCall.params?.arguments?.listenerInstanceId, expectedListenerInstanceId);
  } finally {
    dom.window.close();
  }
});
