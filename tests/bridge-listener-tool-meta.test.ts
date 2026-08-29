import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registerSource = readFileSync(
  new URL("../src/mcp/tools/bridge-listener/register.ts", import.meta.url),
  "utf8",
);

test("only the model-visible bridge opener carries the listener resource URI", () => {
  const resourceBindings = registerSource.match(/resourceUri:\s*BRIDGE_RESOURCE_URI/g) ?? [];
  assert.equal(resourceBindings.length, 1);
  assert.match(
    registerSource,
    /const appMeta = \{ ui: \{ visibility: \["app"\] as \["app"\] \} \};/,
  );
});
