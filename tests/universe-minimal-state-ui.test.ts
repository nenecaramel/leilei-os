import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
);
const stateCss = readFileSync(
  new URL("../web/src/pages/universe-state-polish.css", import.meta.url),
  "utf8",
);

test("Universe loading and empty states are plain centered text on white", () => {
  assert.match(pageSource, /className="universe-state-stage universe-loading-state"/);
  assert.match(pageSource, /className="universe-state-stage universe-empty-state"/);
  assert.match(pageSource, />正在读取 Universe…</);
  assert.match(pageSource, />Universe 还没有内容</);
  assert.doesNotMatch(pageSource, /universe-loading-dots/);
  assert.doesNotMatch(pageSource, /universe-cosmos universe-cosmos-loading/);
  assert.doesNotMatch(pageSource, /universe-cosmos universe-cosmos-state/);

  assert.match(stateCss, /\.universe-state-page[\s\S]*display:\s*flex/);
  assert.match(stateCss, /\.universe-state-stage[\s\S]*place-items:\s*center/);
  assert.match(stateCss, /\.universe-state-copy[\s\S]*color:\s*#8d8d8d/);
  assert.doesNotMatch(stateCss, /universe-dot-pulse/);
});
