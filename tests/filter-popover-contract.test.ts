import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const webRoot = resolve(process.cwd(), "web/src");
const page = (name: string) => readFileSync(resolve(webRoot, "pages", name), "utf8");
const component = readFileSync(resolve(webRoot, "components", "FilterPopover.tsx"), "utf8");
const styles = readFileSync(resolve(webRoot, "styles.css"), "utf8");

test("small filters and searches share one popover shell", () => {
  assert.match(component, /filter-popover-shell/);
  assert.match(component, /filter-popover-shell--search/);
  assert.match(styles, /\.filter-popover-shell\s*\{[\s\S]*?width:\s*max-content[\s\S]*?padding:\s*5px[\s\S]*?border-radius:\s*10px/);
  assert.match(styles, /\.filter-popover-option\s*\{[\s\S]*?font:\s*inherit[\s\S]*?padding:\s*7px 10px/);
  assert.match(styles, /\.filter-popover-shell--search\s*\{[^}]*width:\s*184px/);
  assert.match(styles, /\.filter-popover-search-input\s*\{[\s\S]*?padding:\s*0 10px[\s\S]*?font-size:\s*13px/);
});

test("Memory tag selector is a client-side tag search over existing metadata", () => {
  const source = page("MemoryPageHeader.tsx");
  assert.match(source, /const \[tagQuery, setTagQuery\] = useState\("")/);
  assert.match(source, /tags\.filter/);
  assert.match(source, /<PopoverSearchInput[\s\S]*?placeholder="标签"/);
  assert.match(source, /matchingTags\.map/);
  assert.match(source, /onTagChange\(item\)/);
});

test("filter surfaces use content width while search keeps a fixed width", () => {
  for (const file of ["MemoryPageHeader.tsx", "TaskPageHeader.tsx", "GlobalSearchPageHeader.tsx"]) {
    assert.match(page(file), /<PopoverShell/);
  }
  for (const file of ["MemoryPageHeader.tsx", "DiaryPageHeader.tsx", "TaskPageHeader.tsx"]) {
    assert.match(page(file), /variant="search"/);
  }
  assert.doesNotMatch(styles, /\.filter-popover-shell\s*\{[^}]*min-width:\s*136px/s);
});

test("Global Search scope order is all, active, archived", () => {
  const source = page("GlobalSearchPageHeader.tsx");
  const scope = source.slice(source.indexOf('ariaLabel="Global Search 范围"'));
  assert.ok(scope.indexOf('["all", "全部"]') < scope.indexOf('["active", "当前"]'));
  assert.ok(scope.indexOf('["active", "当前"]') < scope.indexOf('["archived", "已归档"]'));
});

test("Diary and Global Search dates copy Task custom-range disclosure while Task time stays unchanged", () => {
  const diary = page("DiaryPageHeader.tsx");
  const globalSearch = page("GlobalSearchPageHeader.tsx");
  const task = page("TaskPageHeader.tsx");

  for (const source of [diary, globalSearch]) {
    assert.match(source, />\s*全部时间\s*<\/PopoverOption>/);
    assert.match(source, />\s*自定义范围\s*<\/PopoverOption>/);
    assert.match(source, /filter-popover-time-range/);
  }
  assert.match(task, /memory-page-popover task-filter-popover task-time-popover/);
  assert.match(task, /task-custom-range/);
  assert.match(task, /已逾期/);
  assert.match(task, /未来七天/);
});
