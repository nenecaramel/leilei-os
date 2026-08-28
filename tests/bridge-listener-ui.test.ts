import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createBridgeListenerHtml } from "../src/mcp/tools/bridge-listener/listener-resource.js";

test("bridge listener mounts idle and does not send until explicitly started", () => {
  const calls: unknown[] = [];
  const dom = new JSDOM(createBridgeListenerHtml(), {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.defineProperty(window, "parent", { value: { postMessage: (message: unknown) => calls.push(message) } });
    },
  });
  assert.equal(calls.length, 0);
  assert.equal(typeof (dom.window as unknown as { bridgeListener: { start: unknown } }).bridgeListener.start, "function");
  dom.window.close();
});

test("bridge listener uses one explicit sync and visible-message sequence", async () => {
  const calls: Array<{ id: number; method: string; params?: unknown }> = [];
  const dom = new JSDOM(createBridgeListenerHtml(), {
    runScripts: "dangerously",
    beforeParse(window) {
      Object.defineProperty(window, "parent", { value: { postMessage: (message: { id: number; method: string; params?: unknown }) => calls.push(message) } });
    },
  });
  const listener = (dom.window as unknown as { bridgeListener: { start: () => Promise<void> } }).bridgeListener;
  const startPromise = listener.start();
  assert.equal(calls[0]?.method, "tools/call");
  const startId = calls[0]!.id;
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { jsonrpc: "2.0", id: startId, result: { structuredContent: { success: true } } } }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[1]?.method, "tools/call");
  assert.equal((calls[1]?.params as { name: string }).name, "bridge_listener_sync");
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { jsonrpc: "2.0", id: calls[1]!.id, result: { structuredContent: { success: true, data: { event: null } } } } }));
  await startPromise.catch(() => undefined);
  dom.window.close();
});
