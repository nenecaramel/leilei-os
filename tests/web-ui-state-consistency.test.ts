import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const webRoot = resolve(process.cwd(), "web/src");
const page = (name: string) => readFileSync(resolve(webRoot, "pages", name), "utf8");
const styles = () => readFileSync(resolve(webRoot, "styles.css"), "utf8");

test("records use the frozen true/filtered/error copy contract", () => {
  const records = [
    ["MemoryPage.tsx", "记忆"],
    ["DiaryPage.tsx", "日记"],
    ["TaskPage.tsx", "任务"],
  ] as const;
  for (const [file, label] of records) {
    const source = page(file);
    assert.match(source, new RegExp(`还没有${label}`));
    assert.match(source, new RegExp(`没有符合条件的${label}`));
    assert.match(source, /清除条件/);
    assert.match(source, new RegExp(`暂时无法读取${label}`));
    assert.match(source, /请稍后重试。/);
    assert.match(source, /重新加载/);
  }
});

test("records archive and paper contracts stay local and warning-free", () => {
  for (const file of ["MemoryPage.tsx", "DiaryPage.tsx", "TaskPage.tsx"]) {
    const source = page(file);
    assert.match(source, /还没有归档/);
    assert.match(source, /暂时无法读取归档/);
    assert.doesNotMatch(source, /永久删除后无法恢复，确认继续吗？/);
  }
  assert.match(page("MemoryPage.tsx"), /<PaperDetailDialog/);
  assert.match(page("TaskPage.tsx"), /无法读取任务/);
});

test("shared list metadata protects dates and ellipsizes the right field", () => {
  const css = styles();
  assert.match(css, /\.memory-row-meta\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.memory-row-meta[\s\S]*?\.memory-row-meta > span:first-child[\s\S]*?flex:\s*0 0 auto/);
  assert.match(css, /\.memory-row-meta > span:last-child[\s\S]*?flex:\s*1 1 auto/);
  assert.match(css, /text-overflow:\s*ellipsis/);
});

test("paper error and loading states expose the frozen accessibility hooks", () => {
  const css = styles();
  assert.match(css, /\.paper-detail-error[\s\S]*?bottom:\s*40px/);
  assert.match(css, /\.paper-detail-scroll[\s\S]*?inset:\s*42px 0 38px/);
  for (const file of ["MemoryPage.tsx", "DiaryPage.tsx", "TaskPage.tsx"]) {
    const source = page(file);
    assert.match(source, /role="alert"/);
    assert.match(source, /aria-busy="true"/);
    assert.match(source, /aria-hidden="true"/);
    assert.match(source, /paper-detail-state/);
  }
  assert.match(page("DashboardPage.tsx"), /正在读取 Todo/);
  assert.match(page("CalendarPreview.tsx"), /正在读取 Calendar/);
});

test("module state families retain their exact retry and clear labels", () => {
  assert.match(page("GlobalSearchPage.tsx"), /没有找到匹配内容/);
  assert.match(page("GlobalSearchPage.tsx"), /搜索暂时失败/);
  assert.match(page("DaySpacePage.tsx"), /部分 Day Space 内容暂时无法读取/);
  assert.match(page("UniversePage.tsx"), /Universe 暂时无法读取，请稍后重试。/);
  assert.match(page("SystemConnectionsPageContent.tsx"), /Unable to read connection status/);
  assert.match(page("SystemActivityPageContent.tsx"), /Unable to read activity/);
  assert.match(page("SystemDataPageContent.tsx"), /Unable to read data summary/);
});
