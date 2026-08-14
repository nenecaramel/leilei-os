import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
);

test("Universe loading and uninitialized states use lightweight in-canvas presentation", () => {
  assert.match(pageSource, /UniverseLoadingState/);
  assert.match(pageSource, /className="universe-cosmos universe-cosmos-loading"/);
  assert.match(pageSource, /Universe 还没有内容/);
  assert.match(pageSource, /正在读取 Universe…/);
  assert.doesNotMatch(
    pageSource,
    /LeileiOS 模式不会自动导入本地数据或创建种子内容/,
  );
});
