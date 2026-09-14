import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatTaskPaperDeadline,
  formatTaskPaperTimestamp,
  formatTaskRowDeadline,
  type TaskMobileEntry,
} from "../web/src/pages/task-mobile-presentation.js";

const sample: TaskMobileEntry = {
  id: "t",
  title: "Sample",
  description: "Sample",
  status: "pending",
  priority: "normal",
  due_time: "2026-08-09T07:30:00.000Z",
  timezone: "Asia/Shanghai",
  time_bucket: "today",
  tags: [],
  created_at: "2026-08-09T00:00:00.000Z",
  updated_at: "2026-08-09T00:00:00.000Z",
  completed_at: null,
  allowed_actions: [],
};

test("Task paper deadline uses Memory/Diary dotted paper-date language", () => {
  assert.equal(
    formatTaskPaperDeadline(sample.due_time, sample.timezone),
    "2026.08.09 15:30截止",
  );
});

test("Task list deadline keeps its existing slash row format", () => {
  assert.equal(formatTaskRowDeadline(sample), "2026/08/09截止");
});

test("Task completion timestamp does not reuse the deadline suffix", () => {
  assert.equal(
    formatTaskPaperTimestamp(sample.due_time, sample.timezone),
    "2026.08.09 15:30",
  );
});

test("Task deadline editor shows dotted paper date while keeping datetime", async () => {
  const editor = await readFile("web/src/pages/TaskPaperEditor.tsx", "utf8");
  assert.ok(
    editor.includes('props.value.slice(0,10).replaceAll("-",".")'),
    "Task deadline editor must render dotted paper date text",
  );
});

test("Task paper date inherits the exact shared paper typography and baseline", async () => {
  const css = await readFile("web/src/styles.css", "utf8");
  const marker = css.indexOf(
    "/* leilei-task-paper-date-parity-2026-08-09:start */",
  );
  assert.ok(marker >= 0, "date parity marker must exist");
  const round = css.slice(marker);

  assert.match(
    round,
    /\.paper-detail-paper\[id\^="task-"\] \.paper-detail-date\s*\{[\s\S]*?height:\s*auto !important;[\s\S]*?line-height:\s*normal !important;/,
  );

  assert.match(
    round,
    /\.paper-detail-paper\[id\^="task-"\] \.task-paper-deadline-read,[\s\S]*?\.task-paper-deadline-trigger\s*\{[\s\S]*?all:\s*unset;[\s\S]*?font:\s*inherit;[\s\S]*?letter-spacing:\s*inherit;[\s\S]*?line-height:\s*normal;/,
  );
});
