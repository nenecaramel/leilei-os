import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  createMemoryFilterDebouncer,
  pushMemoryFilterHistory,
  subscribeToMemoryFilterHistory,
} from "../web/src/pages/memory-filter-history.js";
import {
  buildMemoryListRequest,
  createLatestMemoryRequestTracker,
  settleLatestMemoryRequest,
} from "../web/src/pages/memory-list-request.js";

test("Memory filter history pushes exact category and restores it through back and forward", async () => {
  const dom = new JSDOM("", {
    url: "https://leilei-os.test/memory?q=focus",
  });
  const restored: unknown[] = [];
  const unsubscribe = subscribeToMemoryFilterHistory(
    dom.window,
    (filters) => restored.push(filters),
  );

  const waitForPopState = () =>
    new Promise<void>((resolve) => {
      dom.window.addEventListener(
        "popstate",
        () => resolve(),
        { once: true },
      );
    });

  pushMemoryFilterHistory(dom.window, {
    q: "focus",
    category: "goal",
    tag: "MCP",
  });

  assert.equal(
    dom.window.location.search,
    "?q=focus&category=goal&tag=MCP",
  );

  const wentBack = waitForPopState();
  dom.window.history.back();
  await wentBack;

  assert.deepEqual(restored.at(-1), {
    q: "focus",
    category: "",
    tag: "",
  });

  const wentForward = waitForPopState();
  dom.window.history.forward();
  await wentForward;

  assert.deepEqual(restored.at(-1), {
    q: "focus",
    category: "goal",
    tag: "MCP",
  });

  unsubscribe();
  dom.window.close();
});

test("Memory request URL safely encodes q and keeps category independent", () => {
  assert.deepEqual(
    buildMemoryListRequest({
      q: "100%_focused\\plan",
      category: "project",
      tag: "road/map",
    }),
    {
      search: "?q=100%25_focused%5Cplan&category=project&tag=road%2Fmap",
      url: "/memory?q=100%25_focused%5Cplan&category=project&tag=road%2Fmap",
    },
  );
});

test("Memory search debounce commits only the latest value", () => {
  const callbacks = new Map<number, () => void>();
  const commits: string[] = [];
  let timer = 0;
  const debouncer = createMemoryFilterDebouncer({
    delayMs: 300,
    commit: (value) => commits.push(value),
    setTimeout(callback) {
      timer += 1;
      callbacks.set(timer, callback);
      return timer;
    },
    clearTimeout(id) {
      callbacks.delete(id as number);
    },
  });

  debouncer.schedule("f");
  debouncer.schedule("focus");
  assert.equal(callbacks.size, 1);
  callbacks.values().next().value?.();
  assert.deepEqual(commits, ["focus"]);
});

test("Memory latest-request tracker rejects stale success and stale failure", async () => {
  const tracker = createLatestMemoryRequestTracker();
  const stale = tracker.begin();
  const latest = tracker.begin();
  const controller = new AbortController();
  const events: string[] = [];

  await settleLatestMemoryRequest({
    request: Promise.resolve("old"),
    ticket: stale,
    signal: controller.signal,
    onSuccess: () => events.push("old-success"),
    onError: () => events.push("old-error"),
  });
  await settleLatestMemoryRequest({
    request: Promise.resolve("new"),
    ticket: latest,
    signal: controller.signal,
    onSuccess: () => events.push("new-success"),
    onError: () => events.push("new-error"),
  });

  assert.deepEqual(events, ["new-success"]);
});
