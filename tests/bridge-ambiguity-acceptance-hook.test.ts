import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createBridgeListenerHtml } from "../src/mcp/tools/bridge-listener/listener-resource.js";

type BridgeCall = {
  id: number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown>; [key: string]: unknown };
};

type ListenerHtmlOptions = {
  ambiguityAcceptanceEnabled?: boolean;
};

const createHtml = createBridgeListenerHtml as unknown as (
  options?: ListenerHtmlOptions,
) => string;

const ambiguityEvent = {
  id: "00000000-0000-4000-8000-000000000099",
  visibleText: "PHASE2 AMBIGUOUS E2E 20260829-HOOK-01",
  modelContext: "acceptance ambiguity route",
};

function createDom(
  calls: BridgeCall[],
  timeoutCallbacks: Array<() => void>,
): JSDOM {
  let dom: JSDOM;
  dom = new JSDOM(createHtml({ ambiguityAcceptanceEnabled: true }), {
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
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 18_000 && typeof callback === "function") {
          timeoutCallbacks.push(callback as () => void);
          return timeoutCallbacks.length as unknown as number;
        }
        return nativeSetTimeout(callback, delay, ...args);
      }) as typeof window.setTimeout;
    },
  });
  return dom;
}

function response(
  dom: JSDOM,
  call: BridgeCall,
  result: unknown,
): void {
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    data: { jsonrpc: "2.0", id: call.id, result },
    source: dom.window.parent,
  }));
}

function toolResult(data: Record<string, unknown> = {}): Record<string, unknown> {
  return { structuredContent: { success: true, data } };
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("enabled acceptance hook drops the host ACK only for the fixed Phase 2 ambiguity prefix", async () => {
  const calls: BridgeCall[] = [];
  const timeouts: Array<() => void> = [];
  const dom = createDom(calls, timeouts);

  try {
    dom.window.document.querySelector<HTMLButtonElement>("[data-bridge-start]")!.click();
    await tick();

    response(dom, calls[0]!, toolResult({ state: "acquired" }));
    await tick();
    response(dom, calls[1]!, {
      ...toolResult({ event: ambiguityEvent }),
      _meta: { bridgeEvent: ambiguityEvent },
    });
    await tick();

    const context = calls.find((call) => call.method === "ui/update-model-context");
    assert.ok(context);
    response(dom, context, {});
    await tick();

    const dispatch = calls.find((call) => call.params?.name === "bridge_listener_dispatch_started");
    assert.ok(dispatch);
    response(dom, dispatch, toolResult({}));
    await tick();

    const message = calls.find((call) => call.method === "ui/message");
    assert.ok(message);
    response(dom, message, { isError: false });
    await tick();

    assert.equal(
      calls.some((call) => call.params?.name === "bridge_listener_delivered"),
      false,
      "the controlled acceptance message must ignore the successful host ACK",
    );

    timeouts.at(-1)!();
    await tick();

    assert.equal(
      calls.some((call) => call.params?.name === "bridge_listener_delivery_unknown"),
      true,
      "the existing timeout path must quarantine the event as delivery_unknown",
    );
  } finally {
    dom.window.close();
  }
});

test("acceptance hook is explicitly wired from runtime env to the public Bridge resource", () => {
  const envSource = readFileSync("src/config/env.ts", "utf8");
  const runtimeSource = readFileSync("src/app/process-runtime.ts", "utf8");
  const factorySource = readFileSync("src/mcp/server/production-server-factory.ts", "utf8");

  assert.match(envSource, /BRIDGE_AMBIGUITY_ACCEPTANCE_ENABLED/);
  assert.match(runtimeSource, /bridgeAmbiguityAcceptanceEnabled/);
  assert.match(factorySource, /bridgeAmbiguityAcceptanceEnabled/);
  assert.match(factorySource, /registerBridgeListenerResource\(server,\s*\{/);
});
