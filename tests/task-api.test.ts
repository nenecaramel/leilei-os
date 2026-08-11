import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { Request, Response } from "express";
import {
  createArchiveTaskApiHandler,
  createCreateTaskApiHandler,
  createListArchivedTasksApiHandler,
  createListTasksApiHandler,
  createReadArchivedTaskApiHandler,
  createReopenTaskApiHandler,
  createRestoreTaskApiHandler,
  createTaskApiRouter,
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
  author: null,
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
      author: "L",
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
    author: "L",
  }]);
  assert.equal(result.status, 201);
  assert.deepEqual(
    (result.body as { data: { due_time: string | null } }).data.due_time,
    null,
  );
});

test("task create maps missing author to a safe invalid request", async () => {
  const handler = createCreateTaskApiHandler({
    taskService: {
      async createWebTask() {
        throw new TaskDomainError("AUTHOR_REQUIRED", "private author detail");
      },
    } as never,
  });
  const { result, response } = responseRecorder();
  await handler({
    webUserId: "user-1",
    body: {
      title: "标题",
      description: "正文",
      priority: "normal",
      tags: [],
    },
  } as unknown as Request, response, () => {});
  assert.equal(result.status, 400);
  assert.doesNotMatch(JSON.stringify(result.body), /private author detail/);
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
      author: "G",
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
    author: "G",
  }]);
  assert.deepEqual(result.body, { success: true, data: task });
});

test("Task archived API handlers preserve authenticated identity and lifecycle methods", async () => {
  const calls: unknown[] = [];
  const service = {
    async listArchivedTasks(input: unknown) {
      calls.push(["list", input]);
      return { tasks: [task], metadata: { count: 1 } };
    },
    async readArchivedTask(input: unknown) {
      calls.push(["detail", input]);
      return task;
    },
    async archiveTask(input: unknown) {
      calls.push(["archive", input]);
    },
    async restoreTask(input: unknown) {
      calls.push(["restore", input]);
    },
  };

  for (const [handler, request] of [
    [createListArchivedTasksApiHandler({ taskService: service as never }), { webUserId: "user-1" }],
    [createReadArchivedTaskApiHandler({ taskService: service as never }), { webUserId: "user-1", params: { id: "task-1" } }],
    [createArchiveTaskApiHandler({ taskService: service as never }), { webUserId: "user-1", params: { id: "task-1" } }],
    [createRestoreTaskApiHandler({ taskService: service as never }), { webUserId: "user-1", params: { id: "task-1" } }],
  ] as const) {
    const { response } = responseRecorder();
    await handler(request as unknown as Request, response, () => {});
  }

  assert.deepEqual(calls, [
    ["list", { userId: "user-1" }],
    ["detail", { userId: "user-1", id: "task-1" }],
    ["archive", { userId: "user-1", id: "task-1" }],
    ["restore", { userId: "user-1", id: "task-1" }],
  ]);
});

for (const code of ["TASK_NOT_FOUND", "USER_DISABLED", "USER_NOT_FOUND"] as const) {
  test(`Task lifecycle API safely maps ${code}`, async () => {
    const handler = createArchiveTaskApiHandler({
      taskService: {
        async archiveTask() {
          throw new TaskDomainError(code, "private internal details");
        },
      } as never,
    });
    const { result, response } = responseRecorder();
    await handler({
      webUserId: "user-1",
      params: { id: "task-1" },
    } as unknown as Request, response, () => {});
    assert.equal(result.status, code === "TASK_NOT_FOUND" ? 404 : 403);
    assert.doesNotMatch(JSON.stringify(result.body), /private internal details/);
  });
}

test("Task lifecycle endpoints reject unauthenticated requests before service calls", async () => {
  let calls = 0;
  const handler = createRestoreTaskApiHandler({
    taskService: {
      async restoreTask() {
        calls += 1;
      },
    } as never,
  });
  const { result, response } = responseRecorder();
  await handler({ params: { id: "task-1" } } as unknown as Request, response, () => {});
  assert.equal(result.status, 401);
  assert.equal(calls, 0);
});

test("Task archived routes take precedence over /:id and no permanent-delete route exists", async () => {
  const calls: string[] = [];
  const app = express();
  app.use((request, _response, next) => {
    request.webUserId = "user-1";
    next();
  });
  app.use("/task", createTaskApiRouter({
    taskService: {
      async listArchivedTasks() {
        calls.push("archived-list");
        return { tasks: [], metadata: { count: 0 } };
      },
      async readArchivedTask({ id }) {
        calls.push(`archived-detail:${id}`);
        return task;
      },
      async readTask({ id }) {
        calls.push(`active-detail:${id}`);
        return task;
      },
      async restoreTask({ id }) {
        calls.push(`restore:${id}`);
      },
      async archiveTask({ id }) {
        calls.push(`archive:${id}`);
      },
    } as never,
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}/task`;
    assert.equal((await fetch(`${base}/archived`)).status, 200);
    assert.equal((await fetch(`${base}/archived/task-1`)).status, 200);
    assert.equal((await fetch(`${base}/archived/task-1/restore`, {
      method: "POST",
    })).status, 200);
    assert.equal((await fetch(`${base}/task-1`, { method: "DELETE" })).status, 200);
    assert.equal((await fetch(`${base}/task-1/permanent`, {
      method: "DELETE",
    })).status, 404);
    assert.deepEqual(calls, [
      "archived-list",
      "archived-detail:task-1",
      "restore:task-1",
      "archive:task-1",
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("Task reopen route uses the authenticated user and returns the task envelope", async () => {
  const calls: unknown[] = [];
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.webUserId = "user-1";
    next();
  });
  app.use("/task", createTaskApiRouter({
    taskService: {
      async reopenTask(input: unknown) {
        calls.push(input);
        return task;
      },
    } as never,
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/task/task-1/reopen`, {
      method: "POST",
      body: JSON.stringify({ status: "pending", userId: "attacker" }),
      headers: { "content-type": "application/json" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: task });
    assert.deepEqual(calls, [{ userId: "user-1", id: "task-1" }]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Task reopen maps invalid state and concurrent conflict without leaking internals", async () => {
  for (const code of ["INVALID_TASK_REOPEN_STATE", "TASK_STATUS_CONFLICT"] as const) {
    const handler = createTaskApiRouter({
      taskService: {
        async reopenTask() {
          throw new TaskDomainError(code, "private task state details");
        },
      } as never,
    });
    const app = express();
    app.use((request, _response, next) => {
      request.webUserId = "user-1";
      next();
    });
    app.use("/task", handler);
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const response = await fetch(`http://127.0.0.1:${address.port}/task/task-1/reopen`, { method: "POST" });
      assert.equal(response.status, 409);
      const body = await response.json() as { error: { code: string; message: string } };
      assert.equal(body.error.code, code);
      assert.doesNotMatch(body.error.message, /private task state details/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test("Task reopen maps missing task and missing user consistently", async () => {
  for (const code of ["TASK_NOT_FOUND", "USER_NOT_FOUND", "USER_DISABLED"] as const) {
    const handler = createReopenTaskApiHandler({
      taskService: {
        async reopenTask() {
          throw new TaskDomainError(code, "private task details");
        },
      } as never,
    });
    const { result, response } = responseRecorder();
    await handler({ webUserId: "user-1", params: { id: "task-1" } } as unknown as Request, response, () => {});
    assert.equal(result.status, code === "TASK_NOT_FOUND" ? 404 : 403);
    assert.doesNotMatch(JSON.stringify(result.body), /private task details/);
  }

  let calls = 0;
  const unauthenticated = createReopenTaskApiHandler({
    taskService: {
      async reopenTask() {
        calls += 1;
        return task;
      },
    } as never,
  });
  const { result, response } = responseRecorder();
  await unauthenticated({ params: { id: "task-1" } } as unknown as Request, response, () => {});
  assert.equal(result.status, 401);
  assert.equal(calls, 0);
});
