import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const listenerSource = readFileSync(
  new URL("../src/mcp/tools/bridge-listener/listener-resource.ts", import.meta.url),
  "utf8",
);

test("bridge listener exposes bounded host-call diagnostics and a manual sync probe", () => {
  assert.match(listenerSource, /data-bridge-sync/);
  assert.match(listenerSource, /Sync now/);
  assert.match(listenerSource, /data-bridge-diag/);
  assert.match(listenerSource, /const recordDiag =/);
  assert.match(listenerSource, /sync\('manual'\)/);
  assert.match(listenerSource, /renew tick/);
  assert.match(listenerSource, /sent id=/);
  assert.match(listenerSource, /timeout id=/);
  assert.match(listenerSource, /response id=/);
});
