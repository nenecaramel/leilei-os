import assert from "node:assert/strict";
import test from "node:test";
import { loadAuthComponents, mountAuth } from "./helpers/auth-component-harness.js";

test("actual Auth0 provider persists cache and enables refresh tokens only in standalone mode", async () => {
  const { AppAuthProvider } = await loadAuthComponents();
  for (const [displayMode, iosStandalone, standalone] of [
    [false, false, false], [true, false, true], [false, true, true],
  ] as const) {
    const page = await mountAuth(AppAuthProvider, { displayMode, iosStandalone });
    try {
      const props = page.providerProps();
      assert.ok(props);
      assert.equal(props.cacheLocation, standalone ? "localstorage" : "memory");
      assert.equal(props.useRefreshTokens, standalone);
      assert.equal(props.domain, "auth.example");
      assert.equal(props.clientId, "client");
      assert.deepEqual(props.authorizationParams, {
        redirect_uri: "https://leilei.test/", audience: "api", scope: "openid profile email read:diary",
      });
      assert.ok(page.container.querySelector("[data-auth-provider] [data-private-child]"));
    } finally { await page.cleanup(); }
  }
});

test("missing configuration renders configuration screen without initializing Auth0", async () => {
  const { AppAuthProvider } = await loadAuthComponents(null);
  const page = await mountAuth(AppAuthProvider, { displayMode: true });
  try {
    assert.equal(page.providerProps(), undefined);
    assert.equal(page.container.querySelector("[data-private-child]"), null);
    assert.equal(page.container.querySelector("h1")?.textContent, "等待 Auth0 配置");
  } finally { await page.cleanup(); }
});
