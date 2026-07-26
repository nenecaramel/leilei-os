import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
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
  tags: [],
  created_at: "2026-07-22T09:00:00.000Z",
  updated_at: "2026-07-22T09:00:00.000Z",
  completed_at: null,
  allowed_actions: ["start", "cancel"] as const,
};

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
