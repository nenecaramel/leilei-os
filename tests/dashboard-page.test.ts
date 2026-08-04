import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { summarizeDashboardTasks } from "../web/src/pages/dashboard-tasks.js";

const dashboardSource = readFileSync(new URL("../web/src/pages/DashboardPage.tsx", import.meta.url), "utf8");
const taskSource = readFileSync(new URL("../web/src/pages/TaskPage.tsx", import.meta.url), "utf8");

test("Dashboard exposes exactly the three core modules and the required task metrics", () => {
  assert.equal((dashboardSource.match(/quickTarget="(?:memory|diary|task)"/g) ?? []).length, 3);
  assert.doesNotMatch(dashboardSource, /Archive/);
  assert.doesNotMatch(dashboardSource, /Today at a glance/);
  assert.match(dashboardSource, /新增记忆/);
  assert.match(dashboardSource, /写日记/);
  assert.match(dashboardSource, /新建任务/);
  assert.match(dashboardSource, /3 modules connected/);
  assert.match(dashboardSource, /正在读取/);
  assert.match(dashboardSource, /读取失败/);
  assert.match(dashboardSource, /\[0, 1, 2\]/);
  const summary = summarizeDashboardTasks([
    { status: "pending", due_time: "2026-01-01", time_bucket: "overdue" },
    { status: "in_progress", due_time: null, time_bucket: "no_due_date" },
    { status: "completed", due_time: null, time_bucket: "overdue" },
    { status: "cancelled", due_time: null, time_bucket: "overdue" },
  ]);
  assert.equal(`${summary.openTasks.length} 项待处理 · ${summary.overdueTaskCount} 项逾期 · ${summary.completedTasks.length} 项已完成`, "2 项待处理 · 1 项逾期 · 1 项已完成");
});

test("Dashboard module cards keep list links separate from quick-create buttons", () => {
  assert.match(dashboardSource, /<Link className="space-card-main"[\s\S]*?to=\{href\}/);
  assert.match(dashboardSource, /<button className="secondary-button" type="button"[\s\S]*?quickTarget/);
  assert.match(dashboardSource, /<Link className="space-card-main"[\s\S]*?<\/Link>[\s\S]*?<button className="secondary-button"/);
});

test("Task keeps its create form before filters and wires title focus", () => {
  const createIndex = taskSource.indexOf("<h2>创建任务</h2>");
  const filtersIndex = taskSource.indexOf('className="memory-message task-filters"');
  assert.ok(createIndex >= 0 && filtersIndex >= 0 && createIndex < filtersIndex);
  assert.match(taskSource, /ref=\{createTitleInput\}/);
  assert.match(taskSource, /focusCreateRef\.current = true/);
});
