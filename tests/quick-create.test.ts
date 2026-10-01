import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import {
  consumeQuickCreateTarget,
  createQuickCreateState,
  isQuickCreateTarget,
} from "../web/src/pages/quick-create.js";

const quickCreateSource = readFileSync(new URL("../web/src/pages/quick-create.ts", import.meta.url), "utf8");

test("quick-create state accepts only known modules and is consumed once", () => {
  assert.equal(isQuickCreateTarget("diary"), true);
  assert.equal(isQuickCreateTarget("memory"), false);
  assert.equal(isQuickCreateTarget("task"), false);
  assert.equal(isQuickCreateTarget("settings"), false);
  const dom = new JSDOM("", { url: "https://leilei.test/diary" });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  try {
    dom.window.history.replaceState({ globalSearch: { version: 1 }, quickCreate: "diary" }, "", "/diary");
    assert.equal(consumeQuickCreateTarget("diary"), true);
    assert.equal(dom.window.history.state.quickCreate, undefined);
    assert.deepEqual(dom.window.history.state.globalSearch, { version: 1 });
    assert.equal(consumeQuickCreateTarget("diary"), false);
  } finally {
    previous ? Object.defineProperty(globalThis, "window", previous) : Reflect.deleteProperty(globalThis, "window");
    dom.window.close();
  }
});

test("quick-create state preserves existing history fields", () => {
  assert.deepEqual(createQuickCreateState({ globalSearch: { version: 1 } }, "diary"), {
    globalSearch: { version: 1 },
    quickCreate: "diary",
  });
});

test("quick-create consumes wrong and malformed intents without touching other history state", () => {
  const dom = new JSDOM("", { url: "https://leilei.test/diary" });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  try {
    const cases: unknown[] = ["task", "", [], {}, 42];
    for (const intent of cases) {
      dom.window.history.replaceState({ globalSearch: { version: 1 }, quickCreate: intent }, "", "/diary");
      assert.equal(consumeQuickCreateTarget("diary"), false);
      assert.equal("quickCreate" in dom.window.history.state, false);
      assert.deepEqual(dom.window.history.state.globalSearch, { version: 1 });
    }
  } finally {
    previous ? Object.defineProperty(globalThis, "window", previous) : Reflect.deleteProperty(globalThis, "window");
    dom.window.close();
  }
});

test("quick-create with no intent leaves the current History state untouched", () => {
  const dom = new JSDOM("", { url: "https://leilei.test/diary" });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  try {
    dom.window.history.replaceState({ globalSearch: { version: 1 } }, "", "/diary");
    assert.equal(consumeQuickCreateTarget("diary"), false);
    assert.deepEqual(dom.window.history.state, { globalSearch: { version: 1 } });
  } finally {
    previous ? Object.defineProperty(globalThis, "window", previous) : Reflect.deleteProperty(globalThis, "window");
    dom.window.close();
  }
});

test("quick-create does not persist intent outside browser History state", () => {
  assert.doesNotMatch(quickCreateSource, /localStorage|sessionStorage/);
});
