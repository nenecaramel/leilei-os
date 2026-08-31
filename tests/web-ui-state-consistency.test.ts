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
  assert.doesNotMatch(page("DashboardPage.tsx"), /正在读取 Todo/);
  assert.doesNotMatch(page("CalendarPreview.tsx"), /正在读取 Calendar/);
});

test("Memory archive true-empty uses the centered mobile empty-state geometry", () => {
  const memory = page("MemoryPage.tsx");
  const css = styles();
  assert.match(memory, /<MemoryMessage title="还没有归档记忆" className="memory-archive-empty-state" \/>/);
  const start = css.indexOf(".memory-page .memory-module-state.memory-archive-empty-state");
  assert.ok(start >= 0, "Memory archive true-empty needs an explicit mobile geometry rule");
  const end = css.indexOf("}", start);
  const block = css.slice(start, end);
  assert.match(block, /width:\s*min\(100%,\s*280px\)/);
  assert.match(block, /margin:\s*96px auto 0/);
  assert.match(block, /justify-content:\s*center/);
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

test("mobile Paper read states use the frozen signature placeholder", () => {
  const cases = [
    ["MemoryPage.tsx", ["正在读取 Memory", "无法读取 Memory", "正在读取归档 Memory", "无法读取归档 Memory"]],
    ["DiaryPage.tsx", ["正在读取 Diary", "无法读取 Diary", "正在读取已归档 Diary", "无法读取已归档 Diary"]],
    ["TaskPage.tsx", ["正在读取 Task", "无法读取 Task", "正在读取归档 Task", "无法读取归档 Task"]],
  ] as const;

  for (const [file, labels] of cases) {
    const source = page(file);
    for (const label of labels) {
      const start = source.indexOf(`label="${label}"`);
      assert.ok(start >= 0, `${file} must keep ${label}`);
      assert.match(source.slice(start, start + 220), /signature="—"/);
    }
  }
});

test("Task mobile active detail exposes only the Paper retry action", () => {
  const source = page("TaskPage.tsx");
  const start = source.indexOf('if (props.state === "error" || !props.task)');
  const end = source.indexOf("  const task = props.task;", start);
  assert.ok(start >= 0 && end > start);
  const errorBranch = source.slice(start, end);
  assert.equal((errorBranch.match(/>重试<\/button>/g) ?? []).length, 1);
  assert.doesNotMatch(errorBranch, /topRight=/);
});

test("Diary desktop detail error keeps a centered retryable state", () => {
  const source = page("DiaryPage.tsx");
  const start = source.indexOf("function MobileDiaryDetail");
  const end = source.indexOf("function MobileArchivedDiaryList", start);
  assert.ok(start >= 0 && end > start);
  const detail = source.slice(start, end);
  assert.match(detail, /role="alert"/);
  assert.match(detail, /重试/);
  assert.match(detail, /<PaperDetailDialog/);
});

test("Global Search desktop blocking states use the vertical frozen hierarchy", () => {
  const css = styles();
  const start = css.lastIndexOf("@media (min-width: 761px)");
  const end = css.indexOf("@media (max-width: 760px)", start);
  assert.ok(start >= 0 && end > start);
  const desktop = css.slice(start, end);
  assert.match(desktop, /global-search-error-line\.global-search-state-line-offset[\s\S]*display:\s*grid/);
  assert.match(desktop, /global-search-error-line\.global-search-state-line-offset[\s\S]*gap:\s*10px/);
  assert.match(desktop, /global-search-error-line\.global-search-state-line-offset[\s\S]*margin:\s*64px auto 0/);
  assert.match(desktop, /global-search-error-line\.global-search-state-line-offset button[\s\S]*font-size:\s*11px[\s\S]*font-weight:\s*500/);
});

test("Task Archive read failure is an alert state", () => {
  const source = page("TaskPage.tsx");
  const start = source.indexOf('title="暂时无法读取归档任务"');
  assert.ok(start >= 0);
  assert.match(source.slice(start - 80, start + 260), /role="alert"/);
});
