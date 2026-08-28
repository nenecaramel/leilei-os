import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createBridgeListenerHtml } from "../src/mcp/tools/bridge-listener/listener-resource.js";

type BridgeCall = {
  id: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown>; [key: string]: unknown };
};

const eventRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  visibleText: "hello",
  modelContext: "route hint",
};

function createDom(calls: BridgeCall[], pollCallbacks: Array<() => void> = []): JSDOM {
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
      const setTimeout = window.setTimeout.bind(window);
      window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 10_000 && typeof callback === "function") {
          pollCallbacks.push(callback as () => void);
          return 1 as unknown as number;
        }
        return setTimeout(callback, delay, ...args);
      }) as typeof window.setTimeout;
    },
  });
}

function response(
  dom: JSDOM,
  calls: BridgeCall[],
  index: number,
  result: unknown,
  options: { source?: unknown; jsonrpc?: string } = {},
): void {
  const parent = dom.window.parent;
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    data: { jsonrpc: options.jsonrpc ?? "2.0", id: calls[index]!.id, result },
    source: options.source ?? parent,
  }));
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function toolResult(data: Record<string, unknown> = {}): Record<string, unknown> {
  return { structuredContent: { success: true, data } };
}

test("bridge listener mounts an idle control surface and starts only from its visible control", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]");
    const stop = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-stop]");
    const status = dom.window.document.querySelector<HTMLElement>("[data-bridge-status]");
    assert.ok(start);
    assert.ok(stop);
    assert.ok(status);
    assert.equal(status.textContent, "Idle");
    assert.equal(stop.disabled, true);
    assert.equal(calls.length, 0);

    start.click();
    assert.equal(calls[0]?.params?.name, "bridge_listener_start");
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    assert.equal(calls[1]?.params?.name, "bridge_listener_sync");
    response(dom, calls, 1, toolResult({ event: null }));
    await tick();
    assert.equal(status.textContent, "Running");
    assert.equal(stop.disabled, false);

    stop.click();
    assert.equal(calls[2]?.params?.name, "bridge_listener_stop");
    response(dom, calls, 2, toolResult({ stopped: true }));
    await tick();
    assert.equal(status.textContent, "Idle");
  } finally {
    dom.window.close();
  }
});

test("listener stays idle when start returns a busy/error CallToolResult", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    const status = dom.window.document.querySelector<HTMLElement>("[data-bridge-status]")!;
    start.click();
    response(dom, calls, 0, { isError: true, structuredContent: { success: false, error: { code: "BRIDGE_UNAVAILABLE" } } });
    await tick();
    assert.equal(status.textContent, "Idle");
    assert.equal(start.disabled, false);
    assert.equal(calls.some((call) => call.params?.name === "bridge_listener_sync"), false);
  } finally {
    dom.window.close();
  }
});

test("listener accepts responses only from its parent JSON-RPC 2.0 peer", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    start.click();
    response(dom, calls, 0, toolResult({ state: "acquired" }), { source: {} });
    await tick();
    assert.equal(calls.length, 1);
    response(dom, calls, 0, toolResult({ state: "acquired" }), { jsonrpc: "1.0" });
    await tick();
    assert.equal(calls.length, 1);
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    assert.equal(calls[1]?.params?.name, "bridge_listener_sync");
    response(dom, calls, 1, toolResult({ event: null }));
    await tick();
  } finally {
    dom.window.close();
  }
});

test("listener sends a user-role message and releases definite ui/message rejection", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    start.click();
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    response(dom, calls, 1, toolResult({ event: eventRecord }));
    await tick();
    response(dom, calls, 2, toolResult({}));
    await tick();

    const message = calls.find((call) => call.method === "ui/message");
    assert.ok(message);
    assert.deepEqual((message.params as { content: Array<Record<string, unknown>> }).content[0], {
      type: "text",
      text: "@LeileiOS hello",
    });
    assert.equal((message.params as { role?: string }).role, "user");

    response(dom, calls, calls.indexOf(message), { isError: true });
    await tick();
    assert.equal(calls.at(-1)?.params?.name, "bridge_listener_release");
  } finally {
    dom.window.close();
  }
});

test("dispatch-start failure schedules another poll instead of stalling", async () => {
  const calls: BridgeCall[] = [];
  const polls: Array<() => void> = [];
  const dom = createDom(calls, polls);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    start.click();
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    response(dom, calls, 1, toolResult({ event: eventRecord }));
    await tick();
    response(dom, calls, 2, { isError: true, structuredContent: { success: false } });
    await tick();
    assert.equal(calls.some((call) => call.method === "ui/message"), false);
    assert.equal(polls.length > 0, true);
    polls.shift()!();
    await tick();
    assert.equal(calls.at(-1)?.params?.name, "bridge_listener_sync");
  } finally {
    dom.window.close();
  }
});
