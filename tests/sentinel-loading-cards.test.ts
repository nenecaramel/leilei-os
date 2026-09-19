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

test("Sentinel loading renders all data states as titleless cards", async () => {
  const env = installDom();
  const container = env.dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const api: WebApiClient = { request: async () => new Promise(() => undefined) };

  try {
    root.render(React.createElement(SentinelPageContent, { api }));
    await waitForPaint();

    const primary = container.querySelector('section.sentinel-status-card[aria-label="Sentinel status"]');
    assert.ok(primary);
    assert.ok(primary?.querySelector(".sentinel-card-state"));
    assert.equal(primary?.querySelector("h2"), null);

    const labels = [
      "Wake policy",
      "Sentinel controls",
      "Wake activity",
    ];
    for (const label of labels) {
      const card = container.querySelector(`section[aria-label="${label}"]`);
      assert.ok(card, `${label} state card is rendered`);
      assert.ok(card?.querySelector(".sentinel-card-state"));
      assert.equal(card?.querySelector("h2"), null);
    }

    assert.ok(container.querySelector('[aria-label="ChatGPT / Claude Message Bridge"]'));
    assert.equal(container.querySelectorAll(".sentinel-card-state").length, 4);
    assert.ok(
      [...container.querySelectorAll(".sentinel-card-state p")]
        .every((node) => node.textContent === "Reading..."),
    );
    assert.ok(container.textContent?.includes("Message Bridge"));
    assert.doesNotMatch(
      container.textContent ?? "",
      /Wake Policy|First Wake \/ Controls|Wake Activity/,
    );
  } finally {
    root.unmount();
    await waitForPaint();
    env.restore();
  }
});
