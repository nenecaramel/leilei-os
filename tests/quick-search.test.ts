import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";

const sourcePath = "web/src/layout/QuickSearchPanel.tsx";

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://leilei.test/memory" },
  );
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", {
    configurable: true,
    value: () => {},
  });

  dom.window.requestAnimationFrame = (callback) =>
    dom.window.setTimeout(() => callback(Date.now()), 0);

  return {
    dom,
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      dom.window.close();
    },
  };
}

function reactChange(input: HTMLInputElement, value: string): void {
  const props = Object.values(input).find(
    (candidate): candidate is {
      onChange?: (event: { target: { value: string } }) => void;
    } =>
      typeof candidate === "object" &&
      candidate !== null &&
      "onChange" in candidate,
  );
  assert.equal(typeof props?.onChange, "function");
  props.onChange?.({ target: { value } });
}

function response(name: string) {
  return {
    success: true as const,
    data: {
      results: [
        {
          entity_type: "memory" as const,
          entity_id: `${name.toLowerCase()}-1`,
          stable_name: `${name} result`,
          snippet: `${name} snippet`,
          matched_field: "content",
          match_reason: "field_match",
          lifecycle_status: "active" as const,
          business_time: "2026-08-09T07:30:00.000Z",
          time_basis: "created_at",
          updated_at: "2026-08-09T07:30:00.000Z",
          detail_tool: "get_memory" as const,
          detail_arguments: {
            id: `${name.toLowerCase()}-1`,
            scope: "active" as const,
          },
        },
      ],
      metadata: {
        count: 1,
        has_more: false,
        next_cursor: null,
        searched_modules: ["memory", "diary", "task"] as const,
        searched_scope: "active",
      },
    },
  };
}

test("Quick Search source is active-only, five-result, non-modal, and keeps View All", async () => {
  assert.equal(existsSync(sourcePath), true, "QuickSearchPanel.tsx must exist");
  const [source, topBar, shell] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile("web/src/layout/MobileTopBar.tsx", "utf8"),
    readFile("web/src/layout/AppShell.tsx", "utf8"),
  ]);

  assert.match(source, /limit.*"5"|limit.*5/);
  assert.match(source, /scope.*"active"/);
  assert.match(source, /mode.*"normal"/);
  assert.match(source, /SEARCH_MODULES\.join/);
  assert.doesNotMatch(source, /backdrop|overlay-mask/);
  assert.match(source, /查看全部结果/);
  assert.match(source, /ticket !== sequence\.current/);

  assert.doesNotMatch(topBar, /Link/);
  assert.match(topBar, /aria-controls="quick-search-panel"/);
  assert.match(topBar, /searchButtonRef/);
  assert.match(shell, /QuickSearchPanel/);
});

test("Quick Search aborts stale work and never lets an older response replace the newer query", async () => {
  if (!existsSync(sourcePath)) {
    assert.fail("QuickSearchPanel.tsx must exist");
    return;
  }

  const { QuickSearchPanel } = await import("../web/src/layout/QuickSearchPanel..js");
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);

  const requests: Array<{
    path: string;
    signal?: AbortSignal;
    resolve(value: unknown): void;
  }> = [];

  const api: WebApiClient = {
    request<T>(path: string, init: RequestInit = {}): Promise<T> {
      return new Promise<T>((resolve) => {
        requests.push({
          path,
          signal: init.signal ?? undefined,
          resolve: (value) => resolve(value as T),
        });
      });
    },
  };

  try {
    await React.act(async () => {
      root.render(
        React.createElement(QuickSearchPanel, {
          open: true,
          api,
          triggerRef: { current: null },
          onClose: () => undefined,
        }),
      );
      await new Promise((resolve) => env.dom.window.setTimeout(resolve, 10));
    });

    const input = container.querySelector<HTMLInputElement>("#quick-search-query");
    assert.ok(input);

    await React.act(async () => {
      reactChange(input, "old");
    });
    await React.act(async () => {
      await new Promise((resolve) => env.dom.window.setTimeout(resolve, 250));
    });
    assert.equal(requests.length, 1);
    assert.match(requests[0]!.path, /limit=5/);
    assert.match(requests[0]!.path, /scope=active/);
    assert.match(requests[0]!.path, /mode=normal/);

    await React.act(async () => {
      reactChange(input, "new");
    });
    await React.act(async () => {
      await new Promise((resolve) => env.dom.window.setTimeout(resolve, 250));
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.signal?.aborted, true);

    await React.act(async () => {
      requests[1]!.resolve(response("New"));
      await new Promise((resolve) => env.dom.window.setTimeout(resolve, 0));
    });
    assert.match(container.textContent ?? "", /New result/);

    await React.act(async () => {
      requests[0]!.resolve(response("Old"));
      await new Promise((resolve) => env.dom.window.setTimeout(resolve, 0));
    });
    assert.match(container.textContent ?? "", /New result/);
    assert.doesNotMatch(container.textContent ?? "", /Old result/);
  } finally {
    await React.act(async () => root.unmount());
    env.restore();
  }
});

test("Quick Search uses shared inline states and offers retry after request failure", () => {
  const source = readFileSync(
    new URL("../web/src/layout/QuickSearchPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /import \{ StateSurface \} from "\.\.\/components\/StateSurface"/);
  assert.match(source, /state="loading"[\s\S]*message="Searching\.\.\."[\s\S]*placement="inline"/);
  assert.match(source, /state="empty"[\s\S]*message="没有找到匹配内容"[\s\S]*placement="inline"/);
  assert.match(source, /message="Unable to read search results\."[\s\S]*retryLabel="Retry"[\s\S]*setRetryNonce/);
  assert.match(source, /\[api, open, queryInput, retryNonce\]/);
});
