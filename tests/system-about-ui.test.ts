import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "../web/node_modules/react/index.js";
import { createRoot } from "../web/node_modules/react-dom/client.js";
import test from "node:test";
import {
  SystemAboutPageContent,
} from "../web/src/pages/SystemAboutPageContent.js";

function installDom() {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='root'></div></body></html>",
    {
      url: "https://leilei.test/system/about",
    },
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
    setTimeout(resolve, 35),
  );

test("About renders the approved neutral build information", async () => {
  const env = installDom();
  const container =
    env.dom.window.document.getElementById(
      "root",
    )!;
  const root = createRoot(container);

  root.render(
    React.createElement(
      SystemAboutPageContent,
      {
        buildInfo: {
          version: "0.1.0",
          commit: "1234567",
          environment: "Production",
        },
      },
    ),
  );

  await waitForPaint();

  const text = container.textContent ?? "";
  assert.match(text, /Leilei OS/);
  assert.match(text, /Version/);
  assert.match(text, /0\.1\.0/);
  assert.match(text, /Commit/);
  assert.match(text, /1234567/);
  assert.match(text, /Environment/);
  assert.match(text, /Production/);

  assert.doesNotMatch(
    text,
    /Web API|ChatGPT|MCP|Connected/i,
  );

  root.unmount();
  await waitForPaint();
  env.restore();
});

test("About can display neutral unavailable local metadata", async () => {
  const env = installDom();
  const container =
    env.dom.window.document.getElementById(
      "root",
    )!;
  const root = createRoot(container);

  root.render(
    React.createElement(
      SystemAboutPageContent,
      {
        buildInfo: {
          version: "Local",
          commit: "Unavailable",
          environment: "Development",
        },
      },
    ),
  );

  await waitForPaint();

  const text = container.textContent ?? "";
  assert.match(text, /Local/);
  assert.match(text, /Unavailable/);
  assert.match(text, /Development/);

  root.unmount();
  await waitForPaint();
  env.restore();
});
