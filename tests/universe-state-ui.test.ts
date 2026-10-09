import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(
  new URL("../web/src/pages/UniversePage.tsx", import.meta.url),
  "utf8",
) + readFileSync(new URL("../web/src/pages/universe/UniversePagePresentation.tsx", import.meta.url), "utf8");
const stateCss = readFileSync(
  new URL("../web/src/pages/universe-state-polish.css", import.meta.url),
  "utf8",
);

test("Universe loading and uninitialized states use lightweight in-canvas presentation", () => {
  assert.match(pageSource, /UniverseLoadingState/);
  assert.match(pageSource, /className="universe-cosmos universe-cosmos-loading"/);
  assert.match(pageSource, /UniverseImportFlow/);
  assert.match(pageSource, /message="Reading\.\.\."/);
  assert.doesNotMatch(
    pageSource,
    /LeileiOS 模式不会自动导入本地数据或创建种子内容/,
  );
  assert.match(
    stateCss,
    /\.universe-cosmos-loading,[\s\S]*?\.universe-cosmos-state\s*\{[\s\S]*?width:\s*calc\(100vw - var\(--app-sidebar-width\)\)/,
  );
  assert.match(
    stateCss,
    /\.universe-page \.universe-cosmos\.universe-cosmos-loading,[\s\S]*?\.universe-page \.universe-cosmos\.universe-cosmos-state\s*\{[\s\S]*?width:\s*calc\(100vw - var\(--app-sidebar-width\)\)/,
  );
});
