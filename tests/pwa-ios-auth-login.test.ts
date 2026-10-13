import assert from "node:assert/strict";
import test from "node:test";
import { isStandaloneWebApp } from "../web/src/auth/is-standalone-web-app.js";
import { loadAuthComponents, mountAuth, type AuthState } from "./helpers/auth-component-harness.js";

test("standalone detection is safe without browser globals", () => {
  const prior = ["window", "navigator"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  try {
    for (const [key] of prior) Reflect.deleteProperty(globalThis, key);
    assert.equal(isStandaloneWebApp(), false);
  } finally {
    for (const [key, descriptor] of prior) if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  }
});

test("actual login chooses popup for display-mode and iOS standalone, redirect for browsers", async () => {
  const { ProtectedApp } = await loadAuthComponents();
  for (const [displayMode, iosStandalone, expected] of [
    [false, false, ["redirect"]], [true, false, ["popup"]], [false, true, ["popup"]], [true, true, ["popup"]],
  ] as const) {
    const calls: string[] = [];
    const auth: AuthState = {
      isLoading: false, isAuthenticated: false,
      async loginWithPopup() { calls.push("popup"); },
      async loginWithRedirect() { calls.push("redirect"); },
    };
    const page = await mountAuth(ProtectedApp, { displayMode, iosStandalone, auth });
    try {
      assert.equal(isStandaloneWebApp(), displayMode || iosStandalone);
      assert.deepEqual(calls, [], "mounting must not start authentication");
      assert.equal(page.container.querySelector("[data-private-child]"), null);
      await page.clickLogin();
      assert.deepEqual(calls, expected);
    } finally { await page.cleanup(); }
  }
});

test("standalone popup rejection falls back to redirect, including the retry action", async () => {
  const { ProtectedApp } = await loadAuthComponents();
  for (const error of [undefined, new Error("Auth unavailable")]) {
    const calls: string[] = [];
    const page = await mountAuth(ProtectedApp, { iosStandalone: true, auth: {
      error, isLoading: false, isAuthenticated: false,
      async loginWithPopup() { calls.push("popup"); throw new Error("Popup blocked"); },
      async loginWithRedirect() { calls.push("redirect"); },
    } });
    try {
      if (error) assert.equal(page.container.querySelector("button")?.textContent?.trim(), "重新登录");
      await page.clickLogin();
      assert.deepEqual(calls, ["popup", "redirect"]);
    } finally { await page.cleanup(); }
  }
});

test("loading and successful authentication gate private content and restore page theme", async () => {
  const { ProtectedApp } = await loadAuthComponents();
  const auth: AuthState = { isLoading: true, isAuthenticated: false, async loginWithPopup() {}, async loginWithRedirect() {} };
  const page = await mountAuth(ProtectedApp, { auth });
  try {
    assert.ok(page.container.querySelector('[aria-label="正在检查登录状态"]'));
    assert.equal(page.container.querySelector("button"), null);
    assert.equal(page.container.querySelector("[data-private-child]"), null);
    assert.equal(page.dom.window.document.documentElement.classList.contains("auth-surface-active"), true);
    assert.equal(page.dom.window.document.querySelector('meta[name="theme-color"]')?.getAttribute("content"), "#ffffff");
    await page.updateAuth({ ...auth, isLoading: false, isAuthenticated: true });
    assert.ok(page.container.querySelector("[data-private-child]"));
    assert.equal(page.container.querySelector("button"), null);
    assert.equal(page.dom.window.document.documentElement.classList.contains("auth-surface-active"), false);
    assert.equal(page.dom.window.document.querySelector('meta[name="theme-color"]')?.getAttribute("content"), "#123456");
  } finally { await page.cleanup(); }
});
