import assert from "node:assert/strict";
import test from "node:test";
import type {
  NormalizedTaskCreate,
  TaskRecord,
  TaskRepository,
  TaskUserRecord,
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

  async findUserById(userId: string): Promise<TaskUserRecord | null> {
    this.findUserCalls.push(userId);
    return this.user;
  }

  async createTask(input: NormalizedTaskCreate): Promise<TaskRecord> {
    this.writes.push(input);

    return {
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
  }
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
