import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import { PwaStatus } from "../web/src/pwa/PwaStatus.js";
import { createPwaStateStore } from "../web/src/pwa/pwa-state.js";

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    { url: "https://leilei.test/" },
  );
  const previous = new Map<
    string,
    PropertyDescriptor | undefined
  >();

  for (const key of [
    "window",
    "document",
    "navigator",
    "React",
  ]) {
    previous.set(
      key,
      Object.getOwnPropertyDescriptor(
        globalThis,
        key,
      ),
    );
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === "React"
          ? React
          : dom.window[key as keyof Window],
    });
  }

  return {
    dom,
    restore() {
      for (const key of [
        "window",
        "document",
        "navigator",
        "React",
      ]) {
        const descriptor = previous.get(key);
        if (descriptor) {
          Object.defineProperty(
            globalThis,
            key,
            descriptor,
          );
        } else {
          Reflect.deleteProperty(
            globalThis,
            key,
          );
        }
      }
      dom.window.close();
    },
  };
}

const waitForPaint = () =>
  new Promise((resolve) =>
    setTimeout(resolve, 30),
  );

test("PWA status shows offline state and explicit update action", async () => {
  const env = installDom();
  const container =
    env.dom.window.document.getElementById(
      "root",
    )!;

  let updates = 0;
  const store = createPwaStateStore({
    online: false,
  });
  store.setUpdateAction(async () => {
    updates += 1;
  });
  store.markUpdateAvailable();

  const root = createRoot(container);
  root.render(
    React.createElement(PwaStatus, {
      store,
    }),
  );
  await waitForPaint();

  const text = container.textContent ?? "";
  assert.match(text, /暂时离线/);
  assert.match(
    text,
    /Leilei OS 有新版本/,
  );
  assert.match(text, /刷新/);
  assert.doesNotMatch(text, /刷新使用/);

  const button =
    container.querySelector<HTMLButtonElement>(
      "[data-pwa-update]",
    );
  assert.ok(button);
  button.click();
  await waitForPaint();
  assert.equal(updates, 1);
  assert.equal(
    container.querySelector("[data-pwa-update]"),
    null,
  );
  assert.doesNotMatch(container.textContent ?? "", /Leilei OS 有新版本/);

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("PWA status renders nothing when online and current", async () => {
  const env = installDom();
  const container =
    env.dom.window.document.getElementById(
      "root",
    )!;

  const store = createPwaStateStore({
    online: true,
  });
  const root = createRoot(container);
  root.render(
    React.createElement(PwaStatus, {
      store,
    }),
  );
  await waitForPaint();

  assert.equal(
    container.querySelector(
      "[data-pwa-status]",
    ),
    null,
  );

  root.unmount();
  await waitForPaint();
  env.restore();
});


test("PWA update action keeps a 44px hit target without a filled black button", () => {
  const styles = readFileSync(
    new URL("../web/src/pwa/pwa-status.css", import.meta.url),
    "utf8",
  );
  assert.match(
    styles,
    /\.pwa-status__update-button\s*\{[^}]*min-width:\s*44px[^}]*min-height:\s*44px[^}]*background:\s*transparent[^}]*color:\s*#666[^}]*font-size:\s*12px[^}]*font-weight:\s*500/s,
  );
  assert.match(
    styles,
    /\.pwa-status__update-button:hover,[\s\S]*?background:\s*rgba\(0,\s*0,\s*0,\s*0\.05\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.pwa-status__update-button\s*\{[^}]*background:\s*#111/s,
  );
});
