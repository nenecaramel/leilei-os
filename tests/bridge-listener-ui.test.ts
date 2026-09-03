import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { composeBridgeDispatchContext, createBridgeListenerHtml } from "../src/mcp/tools/bridge-listener/listener-resource.js";

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

function sentinelWakeEvent(eventId: string, wakeId: string) {
  return {
    id: eventId,
    visibleText: "wake up",
    kind: "wake",
    source: "leileios_sentinel",
    modelContext: `wakeId=${wakeId}; sentinelId=33333333-3333-4333-8333-333333333333; controlRevision=4; scheduledFor=2026-08-30T00:00:00.000Z.`,
  };
}

function ordinaryEvent(eventId: string, visibleText: string) {
  return {
    id: eventId,
    visibleText,
    modelContext: "route hint",
  };
}

function createDom(
  calls: BridgeCall[],
  pollCallbacks: Array<() => void> = [],
  timeoutCallbacks: Array<() => void> = [],
): JSDOM {
  let dom: JSDOM;
  dom = new JSDOM(createBridgeListenerHtml(), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      const parent = {
        postMessage(message: BridgeCall) {
          if (message.method === "ui/initialize") {
            queueMicrotask(() => {
              dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
                data: {
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    protocolVersion: "2026-01-26",
                    hostCapabilities: { serverTools: {} },
                    hostInfo: { name: "Test Host", version: "1.0.0" },
                    hostContext: {},
                  },
                },
                source: parent,
              }));
            });
            return;
          }
          if (message.method === "ui/notifications/initialized") return;
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
        if (delay === 18_000 && typeof callback === "function") {
          timeoutCallbacks.push(callback as () => void);
          return 2 as unknown as number;
        }
        return setTimeout(callback, delay, ...args);
      }) as typeof window.setTimeout;
    },
  });
  return dom;
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
    await tick();
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

test("listener stays idle and shows occupied state when start returns a busy CallToolResult", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    const status = dom.window.document.querySelector<HTMLElement>("[data-bridge-status]")!;
    const occupied = dom.window.document.querySelector<HTMLElement>("[data-bridge-occupied]")!;
    start.click();
    await tick();
    response(dom, calls, 0, { isError: true, structuredContent: { success: false, error: { code: "LISTENER_BUSY" } } });
    await tick();
    assert.equal(status.textContent, "Occupied");
    assert.equal(occupied.hidden, false);
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
    await tick();
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
    await tick();
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    response(dom, calls, 1, { ...toolResult({ event: eventRecord }), _meta: { bridgeEvent: eventRecord } });
    await tick();
    response(dom, calls, 2, toolResult({}));
    await tick();
    const dispatch = calls.find((call) => call.params?.name === "bridge_listener_dispatch_started");
    assert.ok(dispatch);
    response(dom, calls, calls.indexOf(dispatch), toolResult({}));
    await tick();

    const message = calls.find((call) => call.method === "ui/message");
    assert.ok(message);
    const content = (message.params as { content: Array<Record<string, unknown>> }).content[0]!;
    assert.equal(content.type, "text");
    assert.equal(content.text, "@LeileiOS hello");
    assert.doesNotMatch(String(content.text), /eventId|wakeId|bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake/i);
    assert.equal((message.params as { role?: string }).role, "user");

    response(dom, calls, calls.indexOf(message), { isError: true });
    await tick();
    assert.equal(calls.at(-1)?.params?.name, "bridge_listener_release");
  } finally {
    dom.window.close();
  }
});

test("each consecutive Sentinel synthetic message carries its own routing identity", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  const first = sentinelWakeEvent(
    "00000000-0000-4000-8000-000000000011",
    "00000000-0000-4000-8000-000000000021",
  );
  const second = sentinelWakeEvent(
    "00000000-0000-4000-8000-000000000012",
    "00000000-0000-4000-8000-000000000022",
  );

  async function dispatch(event: ReturnType<typeof sentinelWakeEvent>) {
    const sync = calls.findLast((call) => call.params?.name === "bridge_listener_sync")!;
    response(dom, calls, calls.indexOf(sync), { ...toolResult({ event }), _meta: { bridgeEvent: event } });
    await tick();

    const context = calls.findLast((call) => call.method === "ui/update-model-context")!;
    response(dom, calls, calls.indexOf(context), toolResult({}));
    await tick();

    const dispatchStarted = calls.findLast((call) => call.params?.name === "bridge_listener_dispatch_started")!;
    response(dom, calls, calls.indexOf(dispatchStarted), toolResult({}));
    await tick();

    const message = calls.findLast((call) => call.method === "ui/message")!;
    const text = ((message.params as { content: Array<{ text: string }> }).content[0]?.text) ?? "";
    assert.equal(text, `@LeileiOS ${event.visibleText}`);
    assert.doesNotMatch(text, /eventId|wakeId|bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake/i);

    const contextText = ((context.params as { content: Array<{ text: string }> }).content[0]?.text) ?? "";
    assert.match(contextText, new RegExp(`eventId=${event.id}`));
    assert.match(contextText, /wakeId=[^;]+/);
    assert.doesNotMatch(contextText, /bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake|claim this wake first|call\s+\w+/i);

    response(dom, calls, calls.indexOf(message), { isError: false });
    await tick();
    const delivered = calls.findLast((call) => call.params?.name === "bridge_listener_delivered")!;
    response(dom, calls, calls.indexOf(delivered), toolResult({}));
    await tick();
  }

  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    const syncNow = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-sync]")!;
    start.click();
    await tick();
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    await dispatch(first);

    syncNow.click();
    await tick();
    await dispatch(second);
  } finally {
    dom.window.close();
  }
});

test("each consecutive ordinary synthetic message carries only its own routing identity", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  const first = ordinaryEvent("00000000-0000-4000-8000-000000000031", "first ordinary event");
  const second = ordinaryEvent("00000000-0000-4000-8000-000000000032", "second ordinary event");

  async function dispatch(event: ReturnType<typeof ordinaryEvent>, otherEventId: string) {
    const sync = calls.findLast((call) => call.params?.name === "bridge_listener_sync")!;
    response(dom, calls, calls.indexOf(sync), { ...toolResult({ event }), _meta: { bridgeEvent: event } });
    await tick();

    const context = calls.findLast((call) => call.method === "ui/update-model-context")!;
    response(dom, calls, calls.indexOf(context), toolResult({}));
    await tick();

    const dispatchStarted = calls.findLast((call) => call.params?.name === "bridge_listener_dispatch_started")!;
    response(dom, calls, calls.indexOf(dispatchStarted), toolResult({}));
    await tick();

    const message = calls.findLast((call) => call.method === "ui/message")!;
    const text = ((message.params as { content: Array<{ text: string }> }).content[0]?.text) ?? "";
    assert.equal(text, `@LeileiOS ${event.visibleText}`);
    assert.doesNotMatch(text, /eventId|wakeId|bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake/i);

    const contextText = ((context.params as { content: Array<{ text: string }> }).content[0]?.text) ?? "";
    assert.match(contextText, new RegExp(`eventId=${event.id}`));
    assert.doesNotMatch(contextText, new RegExp(otherEventId));
    assert.doesNotMatch(contextText, /bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake|call\s+\w+/i);

    response(dom, calls, calls.indexOf(message), { isError: false });
    await tick();
    const delivered = calls.findLast((call) => call.params?.name === "bridge_listener_delivered")!;
    response(dom, calls, calls.indexOf(delivered), toolResult({}));
    await tick();
  }

  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    const syncNow = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-sync]")!;
    start.click();
    await tick();
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    await dispatch(first, second.id);

    syncNow.click();
    await tick();
    await dispatch(second, first.id);
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
    await tick();
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    response(dom, calls, 1, { ...toolResult({ event: eventRecord }), _meta: { bridgeEvent: eventRecord } });
    await tick();
    response(dom, calls, 2, toolResult({}));
    await tick();
    const dispatch = calls.find((call) => call.params?.name === "bridge_listener_dispatch_started");
    assert.ok(dispatch);
    response(dom, calls, calls.indexOf(dispatch), { isError: true, structuredContent: { success: false } });
    await tick();
    const release = calls.find((call) => call.params?.name === "bridge_listener_release");
    assert.ok(release);
    response(dom, calls, calls.indexOf(release), toolResult({}));
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

test("listener quarantines an ambiguous ui/message timeout instead of retrying it", async () => {
  const calls: BridgeCall[] = [];
  const timeouts: Array<() => void> = [];
  const dom = createDom(calls, [], timeouts);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    start.click();
    await tick();
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    response(dom, calls, 1, { ...toolResult({ event: eventRecord }), _meta: { bridgeEvent: eventRecord } });
    await tick();
    response(dom, calls, 2, toolResult({}));
    await tick();
    const dispatch = calls.find((call) => call.params?.name === "bridge_listener_dispatch_started");
    assert.ok(dispatch);
    response(dom, calls, calls.indexOf(dispatch), toolResult({}));
    await tick();
    assert.ok(calls.some((call) => call.method === "ui/message"));
    timeouts.at(-1)!();
    await tick();
    const unknown = calls.find((call) => call.params?.name === "bridge_listener_delivery_unknown");
    assert.ok(unknown);
    assert.equal(calls.some((call) => call.params?.name === "bridge_listener_release"), false);
    response(dom, calls, calls.indexOf(unknown), toolResult({}));
    await tick();
  } finally {
    dom.window.close();
  }
});

test("listener acknowledges only a successful ui/message outcome", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    start.click();
    await tick();
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    response(dom, calls, 1, { ...toolResult({ event: eventRecord }), _meta: { bridgeEvent: eventRecord } });
    await tick();
    response(dom, calls, 2, toolResult({}));
    await tick();
    const dispatch = calls.find((call) => call.params?.name === "bridge_listener_dispatch_started");
    assert.ok(dispatch);
    response(dom, calls, calls.indexOf(dispatch), toolResult({}));
    await tick();
    const message = calls.find((call) => call.method === "ui/message");
    assert.ok(message);
    response(dom, calls, calls.indexOf(message), { isError: false });
    await tick();
    const delivered = calls.find((call) => call.params?.name === "bridge_listener_delivered");
    assert.ok(delivered);
    assert.equal(calls.some((call) => call.params?.name === "bridge_listener_delivery_unknown"), false);
    response(dom, calls, calls.indexOf(delivered), toolResult({}));
    await tick();
  } finally {
    dom.window.close();
  }
});

test("listener composes neutral routing metadata without rewriting persisted context", async () => {
  const calls: BridgeCall[] = [];
  const dom = createDom(calls);
  try {
    const start = dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!;
    start.click();
    await tick();
    response(dom, calls, 0, toolResult({ state: "acquired" }));
    await tick();
    response(dom, calls, 1, { ...toolResult({ event: eventRecord }), _meta: { bridgeEvent: eventRecord } });
    await tick();
    const contextCall = calls.find((call) => call.method === "ui/update-model-context");
    assert.ok(contextCall);
    const text = ((contextCall.params as { content: Array<{ text: string }> }).content[0]?.text) ?? "";
    assert.match(text, /route hint/);
    assert.match(text, /LeileiOS Bridge event metadata: eventId=00000000-0000-4000-8000-000000000001/);
    assert.doesNotMatch(text, /bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake|call\s+\w+/i);
    assert.doesNotMatch(text, /hello/);
    const persisted = eventRecord.modelContext;
    const composed = composeBridgeDispatchContext(eventRecord);
    assert.match(composed, /LeileiOS Bridge event metadata: eventId=00000000-0000-4000-8000-000000000001/);
    assert.doesNotMatch(composed, /bridge_event_claim|bridge_event_complete|sentinel_get_state|complete_sentinel_wake|call\s+\w+/i);
    assert.equal(eventRecord.modelContext, persisted);
  } finally {
    dom.window.close();
  }
});
