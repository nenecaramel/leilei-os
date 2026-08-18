import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PWA pins the Workbox packages used by generated SW and virtual register client", async () => {
  const pkg = JSON.parse(
    await readFile("web/package.json", "utf8"),
  );

  assert.equal(
    pkg.devDependencies["workbox-build"],
    "7.4.1",
  );
  assert.equal(
    pkg.devDependencies["workbox-window"],
    "7.4.1",
  );
});
