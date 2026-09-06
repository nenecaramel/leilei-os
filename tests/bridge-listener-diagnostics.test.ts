import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(
  new URL("../src/mcp/tools/bridge-listener/browser-runtime.ts", import.meta.url),
  "utf8",
);

test("bridge listener exposes bounded host-call diagnostics and a manual sync probe", () => {
  assert.match(runtimeSource, /const recordDiag =/);
  assert.match(runtimeSource, /sync\("manual"\)/);
  assert.match(runtimeSource, /renew tick/);
  assert.match(runtimeSource, /call=\$\{callNumber\}/);
  assert.match(runtimeSource, /app\.connect/);
});
