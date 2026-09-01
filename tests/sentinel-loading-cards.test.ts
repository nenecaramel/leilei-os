import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import { SentinelPageContent } from "../web/src/pages/SentinelPage.js";
import type { WebApiClient } from "../web/src/api/useWebApiClient.js";

function installDom() {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    url: "https://leilei.test/sentinel",
  });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of ["window", "document", "navigator", "React", "crypto"]) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "React"
        ? React
        : key === "crypto"
          ? dom.window.crypto
          : dom.window[key as keyof Window],
    });
  }
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(callback, 0);
  dom.window.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle);
  return {
    dom,
    restore() {
      for (const key of ["window", "document", "navigator", "React", "crypto"]) {
        const descriptor = previous.get(key);
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
      dom.window.close();
    },
  };
}

const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 20));

test("Sentinel loading keeps the final card stack visible and loads each data card in place", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = { request: async () => new Promise(() => undefined) };

  try {
    root.render(React.createElement(SentinelPageContent, { api }));
    await waitForPaint();

    assert.ok(container.querySelector('[aria-label="Sentinel status"]'));
    assert.ok(container.querySelector('[aria-label="ChatGPT Message Bridge"]'));
    assert.ok(container.querySelector('[aria-labelledby="sentinel-policy-title"]'));
    assert.ok(container.querySelector('[aria-label="Sentinel controls"]'));
    assert.ok(container.querySelector('[aria-labelledby="sentinel-activity-title"]'));

    const loadingCopies = [...container.querySelectorAll(".system-state-copy")]
      .map((node) => node.textContent?.trim())
      .filter(Boolean);
    assert.deepEqual(loadingCopies, [
      "Reading Sentinel…",
      "Reading wake policy…",
      "Reading Sentinel controls…",
      "Reading wake activity…",
    ]);

    assert.ok(container.textContent?.includes("Message Bridge"));
    assert.ok(container.textContent?.includes("Wake Policy"));
    assert.ok(container.textContent?.includes("First Wake / Controls"));
    assert.ok(container.textContent?.includes("Wake Activity"));
  } finally {
    root.unmount();
    await waitForPaint();
    env.restore();
  }
});
