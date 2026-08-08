import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatTaskPaperDeadline,
  formatTaskRowDeadline,
  formatTaskRowMeta,
  groupTasksForMobile,
  type TaskMobileEntry,
} from "../web/src/pages/task-mobile-presentation.js";

const base = {
  title: "Task",
  description: "Description",
  priority: "normal" as const,
  timezone: "Asia/Shanghai",
  tags: ["work"],
  created_at: "2026-08-08T01:00:00.000Z",
  updated_at: "2026-08-08T02:00:00.000Z",
  completed_at: null,
  allowed_actions: [] as const,
};

function entry(
  id: string,
  status: TaskMobileEntry["status"],
  bucket: TaskMobileEntry["time_bucket"],
  due: string | null,
  extras: Partial<TaskMobileEntry> = {},
): TaskMobileEntry {
  return { ...base, id, status, time_bucket: bucket, due_time: due, ...extras };
}

test("Task uses the accepted seven-group order", () => {
  const groups = groupTasksForMobile([
    entry("x", "cancelled", "later", null),
    entry("c", "completed", "today", "2026-08-08T08:00:00Z", { completed_at: "2026-08-08T09:00:00Z" }),
    entry("n", "pending", "no_due_date", null),
    entry("l", "pending", "later", "2026-08-20T08:00:00Z"),
    entry("w", "pending", "next_7_days", "2026-08-10T08:00:00Z"),
    entry("t", "in_progress", "today", "2026-08-08T08:00:00Z"),
    entry("o", "pending", "overdue", "2026-08-07T08:00:00Z"),
  ]);
  assert.deepEqual(groups.map((g) => g.label), [
    "Overdue", "Today", "Next 7 Days", "Later", "No Deadline", "Completed", "Cancelled",
  ]);
});

test("No Deadline puts In Progress before Pending", () => {
  const groups = groupTasksForMobile([
    entry("p", "pending", "no_due_date", null, { created_at: "2026-08-08T05:00:00Z" }),
    entry("i", "in_progress", "no_due_date", null, { created_at: "2026-08-07T05:00:00Z" }),
  ]);
  assert.deepEqual(groups[0]?.tasks.map((t) => t.id), ["i", "p"]);
});

test("Task deadline and metadata copy matches design", () => {
  const task = entry("d", "in_progress", "today", "2026-08-08T12:30:00Z", { tags: ["work", "UI"] });
  assert.equal(formatTaskRowDeadline(task), "2026/08/08截止");
  assert.equal(formatTaskPaperDeadline(task.due_time, task.timezone), "2026.08.08 20:30截止");
  assert.equal(formatTaskRowMeta(task), "进行中 · #work #UI");
  assert.equal(formatTaskRowDeadline(entry("n", "pending", "no_due_date", null)), "无截止时间");
});

test("Task header has six accepted tools and no priority UI", async () => {
  const header = await readFile("web/src/pages/TaskPageHeader.tsx", "utf8");
  const page = await readFile("web/src/pages/TaskPage.tsx", "utf8");
  const icons = await readFile("web/src/components/icons.tsx", "utf8");
  const css = await readFile("web/src/styles.css", "utf8");
  const labels = ["按截止时间筛选", "按状态筛选", "按标签筛选", "搜索任务", "查看归档", "新增任务"];
  let cursor = -1;
  for (const label of labels) {
    const next = header.indexOf(`aria-label="${label}"`);
    assert.ok(next > cursor, label);
    cursor = next;
  }
  assert.match(icons, /export const StatusIcon/);
  assert.doesNotMatch(header, /优先级/);
  assert.doesNotMatch(page, /aria-label="优先级筛选"/);
  assert.doesNotMatch(page, /优先级：/);
  assert.match(page, /PaperDetailDialog/);
  assert.match(css, /leilei-task-mobile-redesign-2026-08-08:start/);
});
