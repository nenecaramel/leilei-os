import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createBridgeListenerHtml } from "../src/mcp/tools/bridge-listener/listener-resource.js";

type BridgeCall = {
  id?: number;
  jsonrpc: string;
  method: string;
  params?: Record<string, unknown>;
};

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createDom(calls: BridgeCall[]): JSDOM {
  return new JSDOM(createBridgeListenerHtml(), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      const parent = {
        postMessage(message: BridgeCall) {
          calls.push(message);
        },
      };
      Object.defineProperty(window, "parent", { value: parent });
    },
  });
}

function respond(dom: JSDOM, request: BridgeCall, result: unknown): void {
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    data: { jsonrpc: "2.0", id: request.id, result },
    source: dom.window.parent,
  }));
}

test("bridge listener completes MCP Apps initialization before its first server tool call", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]");
    assert.ok(start);

    start.click();

    assert.equal(calls[0]?.method, "ui/initialize");
    assert.equal(calls.some((call) => call.method === "tools/call"), false);
    assert.deepEqual(calls[0]?.params, {
      appInfo: { name: "LeileiOS Message Bridge", version: "1.0.0" },
      appCapabilities: {},
      protocolVersion: "2026-01-26",
    });

    respond(dom, calls[0]!, {
      protocolVersion: "2026-01-26",
      hostCapabilities: { serverTools: {} },
      hostInfo: { name: "Test Host", version: "1.0.0" },
      hostContext: {},
    });
    await tick();

    assert.equal(calls[1]?.method, "ui/notifications/initialized");
    assert.equal(calls[1]?.id, undefined);
    assert.equal(calls[2]?.method, "tools/call");
    assert.equal((calls[2]?.params as { name?: string } | undefined)?.name, "bridge_listener_start");
  } finally {
    dom.window.close();
  }
});
