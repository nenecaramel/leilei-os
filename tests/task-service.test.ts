import assert from "node:assert/strict";
import test from "node:test";
import type {
  NormalizedTaskCreate,
  NormalizedTaskUpdate,
  TaskRecord,
  TaskRepository,
  TaskStatus,
  TaskUserRecord,
  UpdateTaskStatusInput,
} from "../src/domains/task/task-repository.js";
import {
  TaskDomainError,
  TaskService,
  type CreateTaskInput,
} from "../src/domains/task/task-service.js";

const VALID_INPUT: CreateTaskInput = {
  title: "  完成 Phase 4 设计  ",
  description: "  完成 Task Domain Layer 的验收。  ",
  priority: " HIGH ",
  dueTime: "2026-07-23T16:30:00+08:00",
  timezone: " Asia/Shanghai ",
  tags: [" 项目 ", "MCP", "项目"],
};

class MockTaskRepository implements TaskRepository {
  user: TaskUserRecord | null = { status: "active" };
  findUserCalls: string[] = [];
  writes: NormalizedTaskCreate[] = [];
  statusWrites: UpdateTaskStatusInput[] = [];
  updateWrites: NormalizedTaskUpdate[] = [];
  records = new Map<string, { userId: string; task: TaskRecord }>();

  async findUserById(userId: string): Promise<TaskUserRecord | null> {
    this.findUserCalls.push(userId);
    return this.user;
  }

  async createTask(input: NormalizedTaskCreate): Promise<TaskRecord> {
    this.writes.push(input);

    const task: TaskRecord = {
      id: "00000000-0000-4000-8000-000000000010",
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      dueTime: input.dueTime,
      timezone: input.timezone,
      tags: input.tags,
      createdAt: new Date("2026-07-22T09:00:00.000Z"),
      updatedAt: new Date("2026-07-22T09:00:00.000Z"),
      completedAt: input.completedAt,
    };

    this.records.set(task.id, { userId: input.userId, task });
    return task;
  }

  async findTasks(userId: string): Promise<TaskRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.userId === userId)
      .map((record) => record.task);
  }

  async findTaskById(userId: string, id: string): Promise<TaskRecord | null> {
    const record = this.records.get(id);
    return record?.userId === userId ? record.task : null;
  }

  async updateTaskStatus(input: UpdateTaskStatusInput): Promise<TaskRecord | null> {
    this.statusWrites.push(input);
    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId) return null;
    record.task = {
      ...record.task,
      status: input.status,
      completedAt: input.completedAt,
      updatedAt: new Date("2026-07-22T10:00:00.000Z"),
    };
    return record.task;
  }

  async updateTask(input: NormalizedTaskUpdate): Promise<TaskRecord | null> {
    this.updateWrites.push(input);
    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId) return null;
    record.task = {
      ...record.task,
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueTime: input.dueTime,
      timezone: input.timezone,
      tags: input.tags,
      updatedAt: new Date("2026-07-22T10:00:00.000Z"),
    };
    return record.task;
  }
}

function seedTask(
  repository: MockTaskRepository,
  status: TaskStatus = "pending",
  userId = "user-1",
): TaskRecord {
  const task: TaskRecord = {
    id: "task-1",
    title: "原任务",
    description: "原正文",
    status,
    priority: "normal",
    dueTime: new Date("2026-07-23T08:30:00.000Z"),
    timezone: "Asia/Shanghai",
    tags: ["原标签"],
    createdAt: new Date("2026-07-22T09:00:00.000Z"),
    updatedAt: new Date("2026-07-22T09:00:00.000Z"),
    completedAt: status === "completed" ? new Date("2026-07-22T09:30:00.000Z") : null,
  };
  repository.records.set(task.id, { userId, task });
  return task;
}

test("creates a normalized pending task for the authenticated user", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);

  const result = await service.createTask(
    { userId: "00000000-0000-4000-8000-000000000099" },
    VALID_INPUT,
  );

  assert.deepEqual(repository.findUserCalls, [
    "00000000-0000-4000-8000-000000000099",
  ]);
  assert.equal(repository.writes.length, 1);
  assert.deepEqual(repository.writes[0], {
    userId: "00000000-0000-4000-8000-000000000099",
    title: "完成 Phase 4 设计",
    description: "完成 Task Domain Layer 的验收。",
    status: "pending",
    priority: "high",
    dueTime: new Date("2026-07-23T08:30:00.000Z"),
    timezone: "Asia/Shanghai",
    tags: ["项目", "MCP"],
    completedAt: null,
  });
  assert.equal(result.task.status, "pending");
  assert.equal(result.task.completed_at, null);
  assert.equal(result.task.due_time, "2026-07-23T08:30:00.000Z");
});

test("ignores client-shaped user and status fields and uses domain-owned values", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);
  const untrustedInput = {
    ...VALID_INPUT,
    user_id: "00000000-0000-4000-8000-000000000123",
    status: "completed",
    completed_at: "2026-07-22T10:00:00Z",
  } as CreateTaskInput;

  await service.createTask({ userId: "trusted-user" }, untrustedInput);

  assert.equal(repository.writes[0]!.userId, "trusted-user");
  assert.equal(repository.writes[0]!.status, "pending");
  assert.equal(repository.writes[0]!.completedAt, null);
});

test("rejects missing and disabled authenticated users before writing", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);

  await assert.rejects(
    service.createTask({ userId: "  " }, VALID_INPUT),
    (error: unknown) =>
      error instanceof TaskDomainError &&
      error.code === "INVALID_AUTHENTICATED_USER",
  );
  assert.equal(repository.findUserCalls.length, 0);

  repository.user = { status: "disabled" };
  await assert.rejects(
    service.createTask({ userId: "user-1" }, VALID_INPUT),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "USER_DISABLED",
  );
  assert.equal(repository.writes.length, 0);
});

test("rejects relative, offset-free, and invalid calendar times", async () => {
  const invalidTimes = [
    "明天下午",
    "2026-07-23T16:30:00",
    "2026-02-30T10:00:00Z",
    "2026-07-23T25:00:00+08:00",
    "2026-07-23T10:00:00+15:00",
  ];

  for (const dueTime of invalidTimes) {
    const repository = new MockTaskRepository();
    const service = new TaskService(repository);

    await assert.rejects(
      service.createTask({ userId: "user-1" }, { ...VALID_INPUT, dueTime }),
      (error: unknown) =>
        error instanceof TaskDomainError && error.code === "INVALID_DUE_TIME",
    );
    assert.equal(repository.writes.length, 0);
  }
});

test("rejects invalid timezones, priorities, and tags", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);

  await assert.rejects(
    service.createTask(
      { userId: "user-1" },
      { ...VALID_INPUT, timezone: "Tomorrow/Noon" },
    ),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "INVALID_TIMEZONE",
  );

  await assert.rejects(
    service.createTask(
      { userId: "user-1" },
      { ...VALID_INPUT, priority: "critical" },
    ),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "INVALID_PRIORITY",
  );

  await assert.rejects(
    service.createTask(
      { userId: "user-1" },
      { ...VALID_INPUT, tags: ["valid", "   "] },
    ),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "INVALID_TAGS",
  );
});

test("enforces the only allowed task status transitions", async () => {
  const cases: Array<[TaskStatus, TaskStatus]> = [
    ["pending", "in_progress"],
    ["in_progress", "completed"],
    ["pending", "cancelled"],
    ["in_progress", "cancelled"],
  ];

  for (const [from, to] of cases) {
    const repository = new MockTaskRepository();
    seedTask(repository, from);
    const service = new TaskService(repository);

    const result = await service.updateWebTaskStatus({
      userId: "user-1",
      id: "task-1",
      status: to,
    });

    assert.equal(result.status, to);
    assert.equal(repository.statusWrites.length, 1);
    assert.equal(result.completed_at === null, to !== "completed");
  }
});

test("rejects illegal terminal and skipped task transitions", async () => {
  const cases: Array<[TaskStatus, TaskStatus]> = [
    ["pending", "completed"],
    ["completed", "pending"],
    ["completed", "in_progress"],
    ["cancelled", "pending"],
    ["cancelled", "in_progress"],
    ["completed", "cancelled"],
    ["cancelled", "completed"],
  ];

  for (const [from, to] of cases) {
    const repository = new MockTaskRepository();
    seedTask(repository, from);
    const service = new TaskService(repository);

    await assert.rejects(
      service.updateWebTaskStatus({ userId: "user-1", id: "task-1", status: to }),
      (error: unknown) =>
        error instanceof TaskDomainError &&
        error.code === "INVALID_TASK_STATUS_TRANSITION",
    );
    assert.equal(repository.statusWrites.length, 0);
  }
});

test("treats a repeated status request as an idempotent no-op", async () => {
  const repository = new MockTaskRepository();
  seedTask(repository, "in_progress");
  const service = new TaskService(repository);

  const result = await service.updateWebTaskStatus({
    userId: "user-1",
    id: "task-1",
    status: "in_progress",
  });

  assert.equal(result.status, "in_progress");
  assert.equal(repository.statusWrites.length, 0);
});

test("returns the domain-approved actions for each task state", async () => {
  const cases: Array<[TaskStatus, string[]]> = [
    ["pending", ["start", "cancel"]],
    ["in_progress", ["complete", "cancel"]],
    ["completed", []],
    ["cancelled", []],
  ];

  for (const [status, expectedActions] of cases) {
    const repository = new MockTaskRepository();
    seedTask(repository, status);
    const service = new TaskService(repository);

    const result = await service.readTask({ userId: "user-1", id: "task-1" });
    assert.deepEqual(result.allowed_actions, expectedActions);
  }
});

test("does not read, update, or transition another user's task", async () => {
  const repository = new MockTaskRepository();
  seedTask(repository, "pending", "owner-1");
  const service = new TaskService(repository);

  await assert.rejects(
    service.updateWebTaskStatus({ userId: "owner-2", id: "task-1", status: "in_progress" }),
    (error: unknown) => error instanceof TaskDomainError && error.code === "TASK_NOT_FOUND",
  );
  await assert.rejects(
    service.updateWebTask({ ...VALID_INPUT, userId: "owner-2", id: "task-1" }),
    (error: unknown) => error instanceof TaskDomainError && error.code === "TASK_NOT_FOUND",
  );
  assert.equal(repository.statusWrites.length, 0);
  assert.equal(repository.updateWrites.length, 0);
});

test("persists normalized task edits without changing the current status", async () => {
  const repository = new MockTaskRepository();
  seedTask(repository, "completed");
  const service = new TaskService(repository);

  const result = await service.updateWebTask({
    userId: "user-1",
    id: "task-1",
    title: "  已修正标题  ",
    description: "  已修正正文  ",
    priority: " HIGH ",
    dueTime: "2026-07-24T18:00:00+08:00",
    timezone: " Asia/Shanghai ",
    tags: [" 修正 ", "修正", "任务"],
  });

  assert.equal(result.title, "已修正标题");
  assert.equal(result.description, "已修正正文");
  assert.equal(result.priority, "high");
  assert.equal(result.status, "completed");
  assert.equal(result.completed_at, "2026-07-22T09:30:00.000Z");
  assert.deepEqual(result.tags, ["修正", "任务"]);
});

test("rejects invalid task edits before persistence", async () => {
  const invalidInputs = [
    { title: "   " },
    { priority: "critical" },
    { dueTime: "tomorrow afternoon" },
    { timezone: "Tomorrow/Noon" },
  ];

  for (const invalid of invalidInputs) {
    const repository = new MockTaskRepository();
    seedTask(repository);
    const service = new TaskService(repository);

    await assert.rejects(
      service.updateWebTask({
        userId: "user-1",
        id: "task-1",
        ...VALID_INPUT,
        ...invalid,
      }),
      (error: unknown) => error instanceof TaskDomainError,
    );
    assert.equal(repository.updateWrites.length, 0);
  }
});
