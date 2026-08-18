import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("standalone PWA uses Auth0 popup login while normal browser keeps redirect login", async () => {
  const protectedApp = await readFile("web/src/auth/ProtectedApp.tsx", "utf8");
  const standaloneHelper = await readFile(
    "web/src/auth/is-standalone-web-app.ts",
    "utf8",
  ).catch(() => "");

  assert.match(standaloneHelper, /display-mode:\s*standalone/);
  assert.match(standaloneHelper, /standalone/);
  assert.match(protectedApp, /loginWithPopup/);
  assert.match(protectedApp, /loginWithRedirect/);
  assert.match(protectedApp, /isStandaloneWebApp\(\)/);
  assert.match(
    protectedApp,
    /isStandaloneWebApp\(\)[\s\S]*loginWithPopup\(\)[\s\S]*loginWithRedirect\(\)/,
  );
});
