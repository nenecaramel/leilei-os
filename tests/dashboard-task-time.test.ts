import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDashboardTasks } from "../web/src/pages/dashboard-tasks.js";

test("Dashboard excludes completed and cancelled tasks from overdue count", () => {
  const summary = summarizeDashboardTasks([
    { status: "pending", due_time: "2026-07-20T00:00:00Z", time_bucket: "overdue" },
    { status: "in_progress", due_time: "2026-07-21T00:00:00Z", time_bucket: "overdue" },
    { status: "completed", due_time: "2026-07-19T00:00:00Z", time_bucket: "overdue" },
    { status: "cancelled", due_time: "2026-07-18T00:00:00Z", time_bucket: "overdue" },
  ]);

  assert.equal(summary.overdueTaskCount, 2);
});

test("Dashboard prefers the earliest ordered dated open task over undated tasks", () => {
  const undated = { status: "pending" as const, due_time: null, time_bucket: "no_due_date" as const };
  const dated = { status: "in_progress" as const, due_time: "2026-07-30T00:00:00Z", time_bucket: "later" as const };
  assert.equal(summarizeDashboardTasks([undated, dated]).nextTask, dated);
});
