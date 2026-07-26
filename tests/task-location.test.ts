import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskDetailLocation,
  getSafeTaskReturnTo,
  getTaskDetailLocation,
  readTaskFilters,
} from "../web/src/pages/task-location.js";

test("task filters are restored from the list URL", () => {
  assert.deepEqual(
    readTaskFilters(
      "?q=%E6%8A%A5%E5%91%8A&status=pending&priority=high&tag=work&due=custom&due_from=2026-07-26T00%3A00&due_to=2026-07-27T00%3A00",
    ),
    {
      q: "报告",
      status: "pending",
      priority: "high",
      tag: "work",
      due: "custom",
      dueFrom: "2026-07-26T00:00",
      dueTo: "2026-07-27T00:00",
    },
  );
});

test("invalid due filters safely fall back instead of crashing the task page", () => {
  assert.equal(readTaskFilters("?due=no_due_date").due, "");
});

test("task detail URL preserves the complete list query for refresh-safe return", () => {
  const listUrl = "/task?q=%E6%8A%A5%E5%91%8A&status=pending&tag=work";
  const detailUrl = createTaskDetailLocation("task-123", listUrl);
  const parsed = new URL(detailUrl, "https://leilei-os.invalid");
  const detail = getTaskDetailLocation(parsed.search);

  assert.equal(detail.taskId, "task-123");
  assert.equal(detail.returnTo, listUrl);
});

test("task detail return targets are limited to the internal task list", () => {
  assert.equal(getSafeTaskReturnTo("https://example.com/"), "/task");
  assert.equal(getSafeTaskReturnTo("//example.com/task"), "/task");
  assert.equal(getSafeTaskReturnTo("/settings"), "/task");
  assert.equal(
    getSafeTaskReturnTo("/task?q=report&task=stale&returnTo=%2Fsettings"),
    "/task?q=report",
  );
});
