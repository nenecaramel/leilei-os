import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  BRIDGE_RESOURCE_URI,
  createBridgeListenerHtml,
} from "../src/mcp/tools/bridge-listener/listener-resource.js";

type JsonRpcMessage = {
  id?: number;
  jsonrpc: string;
  method?: string;
};

function createHost(capabilities: Record<string, unknown>): JSDOM {
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
            if (message.method !== "ui/initialize") return;
            queueMicrotask(() => {
              dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
                data: {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    protocolVersion: "host-negotiated",
                    hostCapabilities: capabilities,
                    hostInfo: { name: "ChatGPT-shaped Test Host", version: "1.0.0" },
                    hostContext: {},
                  },
                },
                source: dom.window.parent,
              }));
            });
          },
        },
      });
    },
  });
  return dom;
}

test("Message Bridge resource URI changes when its browser runtime changes", () => {
  assert.equal(BRIDGE_RESOURCE_URI, "ui://leileios/message-bridge/v5");
});

test("Message Bridge host initialization does not depend on capability JSON serialization", async () => {
  const serverTools: Record<string, unknown> = {};
  serverTools.self = serverTools;
  const capabilities = {
    serverTools,
    updateModelContext: {},
    message: {},
  };
  const dom = createHost(capabilities);
  try {
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    const status = dom.window.document.querySelector<HTMLElement>("[data-bridge-status]");
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]");
    assert.ok(status);
    assert.ok(start);
    assert.equal(status.textContent, "Idle");
    assert.equal(start.disabled, false);
  } finally {
    dom.window.close();
  }
});
