import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(process.cwd(), "web/src");
const header = readFileSync(resolve(root, "pages", "GlobalSearchPageHeader.tsx"), "utf8");
const css = readFileSync(resolve(root, "styles.css"), "utf8");

test("Global Search module rows use the shared compact 36px height", () => {
  assert.match(css, /\.global-search-popover > button\s*\{[\s\S]*?min-height:\s*36px/);
  assert.match(css, /\.global-search-module-option\[aria-checked="true"\][\s\S]*?background:\s*transparent\s*!important/);
});

test("Global Search scope is 160px and ordered all-current-archived", () => {
  assert.match(css, /\.global-search-scope-popover\s*\{[^}]*width:\s*160px[^}]*min-width:\s*160px/s);
  const scope = header.slice(header.indexOf('aria-label="Global Search 范围"'));
  assert.ok(scope.indexOf('["all", "全部范围"]') < scope.indexOf('["active", "当前"]'));
  assert.ok(scope.indexOf('["active", "当前"]') < scope.indexOf('["archived", "已归档"]'));
});

test("Global Search date popover uses the normal right-anchored wrapper", () => {
  const dateTool = header.slice(header.indexOf('aria-label="筛选日期"') - 160, header.indexOf('aria-label="筛选日期"') + 900);
  assert.doesNotMatch(dateTool, /task-time-tool-wrap/);
  assert.match(header, /className="memory-page-popover task-filter-popover task-time-popover"/);
  assert.match(css, /\.memory-page-popover\s*\{[^}]*right:\s*0/s);
});
