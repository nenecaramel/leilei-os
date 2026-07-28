import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  createCreateTaskApiHandler,
  createListTasksApiHandler,
  createUpdateTaskApiHandler,
  createUpdateTaskStatusApiHandler,
} from "../src/web-api/task-router.js";
import { TaskDomainError } from "../src/domains/task/task-service.js";

function responseRecorder() {
  const result: { status?: number; body?: unknown } = {};
  const response = {
    status(status: number) {
      result.status = status;
      return response;
    },
    json(body: unknown) {
      result.body = body;
      return response;
    },
  } as unknown as Response;

  return { result, response };
}

const task = {
  id: "task-1",
  title: "任务",
  description: "正文",
  status: "pending" as const,
  priority: "normal" as const,
  due_time: "2026-07-23T08:30:00.000Z",
  timezone: "Asia/Shanghai",
  time_bucket: "later" as const,
  tags: [],
  created_at: "2026-07-22T09:00:00.000Z",
  updated_at: "2026-07-22T09:00:00.000Z",
  completed_at: null,
  allowed_actions: ["start", "cancel"] as const,
};

test("task list api forwards raw query parameters with the authenticated user", async () => {
  const calls: unknown[] = [];
  const handler = createListTasksApiHandler({
    taskService: {
      async listTasks(input) {
        calls.push(input);
        return { tasks: [], metadata: { count: 0 } };
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "user-1",
    query: {
      q: "report",
      status: "pending",
      priority: "high",
      tag: "work",
      due: "custom",
      due_from: "2026-07-22T00:00:00Z",
      due_to: "2026-07-23T00:00:00Z",
    },
  } as unknown as Request, response, () => {});

  assert.deepEqual(calls, [{
    userId: "user-1",
    query: {
      q: "report",
      status: "pending",
      priority: "high",
      tag: "work",
      due: "custom",
      dueFrom: "2026-07-22T00:00:00Z",
      dueTo: "2026-07-23T00:00:00Z",
    },
  }]);
  assert.deepEqual(result.body, {
    success: true,
    data: { tasks: [], metadata: { count: 0 } },
  });
});

test("task create api forwards a null due time through the authenticated service", async () => {
  const calls: unknown[] = [];
  const handler = createCreateTaskApiHandler({
    taskService: {
      async createWebTask(input) {
        calls.push(input);
        return { ...task, due_time: null, time_bucket: "no_due_date" };
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "user-1",
    body: {
      title: "无截止时间",
      description: "保持开放",
      priority: "normal",
      dueTime: null,
      timezone: "Asia/Shanghai",
      tags: [],
    },
  } as unknown as Request, response, () => {});

  assert.deepEqual(calls, [{
    userId: "user-1",
    title: "无截止时间",
    description: "保持开放",
    priority: "normal",
    dueTime: null,
    timezone: "Asia/Shanghai",
    tags: [],
  }]);
  assert.equal(result.status, 201);
  assert.deepEqual(
    (result.body as { data: { due_time: string | null } }).data.due_time,
    null,
  );
});

test("task list api returns a generic bad request without task content", async () => {
  const handler = createListTasksApiHandler({
    taskService: {
      async listTasks() {
        throw new TaskDomainError(
          "INVALID_TASK_QUERY",
          "Search query contains private task title.",
        );
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({ webUserId: "user-1", query: { q: "private" } } as unknown as Request, response, () => {});

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "INVALID_TASK_REQUEST",
      message: "The task request is invalid.",
    },
  });
});

test("task status api delegates status changes with only the authenticated user", async () => {
  const calls: unknown[] = [];
  const handler = createUpdateTaskStatusApiHandler({
    taskService: {
      async updateWebTaskStatus(input) {
        calls.push(input);
        return task;
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "user-1",
    params: { id: "task-1" },
    body: { status: "in_progress" },
  } as unknown as Request, response, () => {});

  assert.deepEqual(calls, [{ userId: "user-1", id: "task-1", status: "in_progress" }]);
  assert.deepEqual(result.body, { success: true, data: task });
});

test("task api returns a safe conflict for illegal status changes", async () => {
  const handler = createUpdateTaskStatusApiHandler({
    taskService: {
      async updateWebTaskStatus() {
        throw new TaskDomainError(
          "INVALID_TASK_STATUS_TRANSITION",
          "Task cannot transition from completed to pending.",
        );
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "user-1",
    params: { id: "task-1" },
    body: { status: "pending" },
  } as unknown as Request, response, () => {});

  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    success: false,
    error: {
      code: "INVALID_TASK_STATUS_TRANSITION",
      message: "Task cannot transition from completed to pending.",
    },
  });
});

test("task edit api forwards only editable fields and preserves identity from context", async () => {
  const calls: unknown[] = [];
  const handler = createUpdateTaskApiHandler({
    taskService: {
      async updateWebTask(input) {
        calls.push(input);
        return task;
      },
    } as never,
  });
  const { result, response } = responseRecorder();

  await handler({
    webUserId: "user-1",
    params: { id: "task-1" },
    body: {
      title: "新标题",
      description: "新正文",
      priority: "high",
      dueTime: "2026-07-24T10:00:00Z",
      timezone: "Asia/Shanghai",
      tags: ["项目"],
      status: "completed",
      userId: "other-user",
    },
  } as unknown as Request, response, () => {});

  assert.deepEqual(calls, [{
    userId: "user-1",
    id: "task-1",
    title: "新标题",
    description: "新正文",
    priority: "high",
    dueTime: "2026-07-24T10:00:00Z",
    timezone: "Asia/Shanghai",
    tags: ["项目"],
  }]);
  assert.deepEqual(result.body, { success: true, data: task });
});
