import assert from "node:assert/strict";
import test from "node:test";
import {
  createArchivedTaskDetailLocation,
  createTaskArchiveLocation,
  createTaskDetailLocation,
  getSafeTaskArchiveReturnTo,
  getSafeTaskReturnTo,
  getTaskArchiveLocation,
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

test("no due date is a supported filter and unknown values remain safe", () => {
  assert.equal(readTaskFilters("?due=no_due_date").due, "no_due_date");
  assert.equal(readTaskFilters("?due=invalid").due, "");
});

test("task detail URL preserves the complete list query for refresh-safe return", () => {
  const listUrl = "/task?q=%E6%8A%A5%E5%91%8A&status=pending&tag=work";
  const detailUrl = createTaskDetailLocation("task-123", listUrl);
  const parsed = new URL(detailUrl, "https://leilei-os.invalid");
  const detail = getTaskDetailLocation(parsed.search);

  assert.equal(detail.taskId, "task-123");
  assert.equal(detail.returnTo, listUrl);
  assert.equal(detail.activeReturnTo, listUrl);
});

test("task detail return targets are limited to the internal task list", () => {
  assert.equal(getSafeTaskReturnTo("https://example.com/"), "/task");
  assert.equal(getSafeTaskReturnTo("//example.com/task"), "/task");
  assert.equal(getSafeTaskReturnTo("/settings"), "/task");
  assert.equal(
    getSafeTaskReturnTo("/task?q=report&task=stale&returnTo=%2Fsettings"),
    "/task",
  );
});

test("unsafe task path parameters do not enter detail mode", () => {
  assert.equal(
    getTaskDetailLocation("?task=%2Fprivate%2Ftask").taskId,
    null,
  );
  assert.equal(
    getTaskDetailLocation("?task=task-123").taskId,
    "task-123",
  );
});

test("Task archive and detail URLs preserve exact active and archived return targets", () => {
  const active =
    "/task?q=abc&status=pending&priority=high&tag=work&due=custom&due_from=2026-07-29&due_to=2026-08-05";
  const archive = createTaskArchiveLocation(active);
  assert.deepEqual(
    getTaskArchiveLocation(new URL(archive, "https://local").search),
    { archived: true, returnTo: active },
  );
  assert.deepEqual(
    getTaskDetailLocation(new URL(archive, "https://local").search),
    {
      taskId: null,
      returnTo: active,
      activeReturnTo: active,
      archived: true,
    },
  );

  const detailUrl = createArchivedTaskDetailLocation("task-1", archive);
  const detail = getTaskDetailLocation(
    new URL(detailUrl, "https://local").search,
  );
  assert.equal(detail.archived, true);
  assert.equal(detail.returnTo, archive);
  assert.equal(detail.activeReturnTo, active);
});

test("Task archive return targets reject external, malformed, and nested detail values", () => {
  const fallback = createTaskArchiveLocation("/task");
  for (const unsafe of [
    "https://example.com/task?archived=1",
    "//example.com/task?archived=1",
    "/task?archived=1&task=task-1",
    "/task?archived=1&returnTo=%2Ftask&returnTo=%2Ftask%3Fq%3Dx",
    "/task?archived=1&returnTo=%2Ftask%3FreturnTo%3Dhttps%253A%252F%252Fevil.test",
  ]) {
    assert.equal(getSafeTaskArchiveReturnTo(unsafe), fallback);
  }
});

test("Task restore targets never accept external or non-list return URLs", () => {
  for (const unsafe of [
    "https://example.com/task",
    "//example.com/task",
    "/task?task=task-1",
    "/settings",
  ]) {
    const archive = createTaskArchiveLocation(unsafe);
    const detail = getTaskDetailLocation(
      new URL(
        createArchivedTaskDetailLocation("task-1", archive),
        "https://local",
      ).search,
    );
    assert.equal(detail.activeReturnTo, "/task");
  }
});
