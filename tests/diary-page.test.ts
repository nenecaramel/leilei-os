import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import * as React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";
import { DiaryPageContent } from "../web/src/pages/DiaryPage.js";
import { createDiaryDetailLocation } from "../web/src/pages/diary-location.js";
import { DEFAULT_SETTINGS } from "../web/src/settings/types.js";

type Request = { path: string; init?: RequestInit };
function pendingApi() {
  const requests: Request[] = [];
  const api: WebApiClient = {
    request<T>(path: string, init?: RequestInit): Promise<T> {
      requests.push({ path, init });
      return new Promise<T>(() => {});
    },
  };
  return { api, requests };
}

async function render(path: string, api: WebApiClient) {
  const dom = new JSDOM("<main id=\"root\"></main>", {
    url: `https://leilei-os.test${path}`,
  });
  const prior = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const install = (name: PropertyKey, value: unknown) => {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true,
    });
  };
  install("window", dom.window);
  install("document", dom.window.document);
  install("navigator", dom.window.navigator);
  install("HTMLElement", dom.window.HTMLElement);
  install("Node", dom.window.Node);
  install("Event", dom.window.Event);
  install("MouseEvent", dom.window.MouseEvent);
  install("PopStateEvent", dom.window.PopStateEvent);
  install("React", React);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  dom.window.scrollTo = () => {};
  dom.window.requestAnimationFrame = (callback) =>
    dom.window.setTimeout(() => callback(Date.now()), 0);
  install(
    "requestAnimationFrame",
    dom.window.requestAnimationFrame.bind(dom.window),
  );
  const container = dom.window.document.querySelector("#root");
  assert.ok(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(DiaryPageContent, {
      api,
      settings: DEFAULT_SETTINGS,
    }));
  });
  return {
    container,
    window: dom.window,
    async cleanup() {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

function assertNoList(container: Element) {
  assert.equal(
    container.querySelector("input[aria-label=\"搜索日记内容\"]"),
    null,
  );
  assert.equal(container.querySelector(".diary-filters"), null);
  assert.equal(container.querySelector(".memory-grid"), null);
}

test("Diary detail refresh starts in detail loading and skips list request", async () => {
  const { api, requests } = pendingApi();
  const page = await render(
    createDiaryDetailLocation(
      "diary-1",
      "/diary?q=trip&tag=Japan",
    ),
    api,
  );
  try {
    assert.match(page.container.textContent ?? "", /正在读取日记/);
    assertNoList(page.container);
    assert.deepEqual(requests.map(({ path }) => path), ["/diary/diary-1"]);
  } finally {
    await page.cleanup();
  }
});

test("Diary list initializes all controls from URL and requests that URL", async () => {
  const { api, requests } = pendingApi();
  const path =
    "/diary?q=trip&tag=Japan&mood=happy&date_from=2026-07-01&date_to=2026-07-07";
  const page = await render(path, api);
  try {
    for (const [label, value] of [
      ["搜索日记内容", "trip"],
      ["按标签筛选", "Japan"],
      ["按心情筛选", "happy"],
      ["开始日期", "2026-07-01"],
      ["结束日期", "2026-07-07"],
    ]) {
      assert.equal(
        page.container.querySelector<HTMLInputElement>(
          `input[aria-label="${label}"]`,
        )?.value,
        value,
      );
    }
    assert.equal(requests[0]?.path, path);
  } finally {
    await page.cleanup();
  }
});

test("Diary popstate aborts the previous list and restores controls without pushing", async () => {
  const { api, requests } = pendingApi();
  const page = await render("/diary?tag=before", api);
  try {
    const initialHistory = page.window.history.length;
    const oldSignal = requests[0]?.init?.signal;
    await React.act(async () => {
      page.window.history.pushState(null, "", "/diary?tag=after&mood=calm");
      page.window.dispatchEvent(new page.window.PopStateEvent("popstate"));
    });
    assert.equal(oldSignal?.aborted, true);
    assert.equal(page.window.history.length, initialHistory + 1);
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"按标签筛选\"]",
      )?.value,
      "after",
    );
    assert.equal(requests.at(-1)?.path, "/diary?tag=after&mood=calm");
  } finally {
    await page.cleanup();
  }
});

test("Diary refreshed detail explicitly returns to complete safe filters", async () => {
  const { api } = pendingApi();
  const returnTo =
    "/diary?q=trip&tag=Japan&mood=happy&date_from=2026-07-01";
  const page = await render(
    createDiaryDetailLocation("diary-1", returnTo),
    api,
  );
  try {
    const button = [...page.container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "返回日记列表");
    assert.ok(button);
    await React.act(async () => {
      button.dispatchEvent(new page.window.MouseEvent("click", {
        bubbles: true,
      }));
    });
    assert.equal(
      `${page.window.location.pathname}${page.window.location.search}`,
      returnTo,
    );
    assert.equal(
      page.container.querySelector<HTMLInputElement>(
        "input[aria-label=\"搜索日记内容\"]",
      )?.value,
      "trip",
    );
  } finally {
    await page.cleanup();
  }
});
