import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appNavigationSource = readFileSync(
  new URL("../web/src/pages/app-navigation.ts", import.meta.url),
  "utf8",
);

test("Universe and Diary provenance navigation stays inside the SPA so browser auth memory survives", () => {
  assert.doesNotMatch(appNavigationSource, /window\.location\.assign\(/);
  assert.match(appNavigationSource, /window\.history\.pushState\(/);
});
