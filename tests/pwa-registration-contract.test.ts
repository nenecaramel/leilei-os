import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PWA registration uses prompt lifecycle and browser network events", async () => {
  const source = await readFile("web/src/pwa/register-pwa.ts", "utf8");
  assert.match(source, /virtual:pwa-register/);
  assert.match(source, /onNeedRefresh/);
  assert.match(source, /markUpdateAvailable/);
  assert.match(source, /window\.addEventListener\(["']online["']/);
  assert.match(source, /window\.addEventListener\(["']offline["']/);
  assert.match(source, /updateSW\(true\)/);
});

test("PWA registration starts from main instead of AppShell", async () => {
  const main = await readFile("web/src/main.tsx", "utf8");
  const shell = await readFile("web/src/layout/AppShell.tsx", "utf8");
  assert.match(main, /startPwaRegistration/);
  assert.doesNotMatch(shell, /virtual:pwa-register|register-pwa/);
});
