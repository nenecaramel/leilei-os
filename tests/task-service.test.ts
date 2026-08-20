import assert from "node:assert/strict";
import test from "node:test";
import type {
  NormalizedTaskCreate,
  NormalizedTaskUpdate,
  TaskRecord,
  TaskRepository,
  TaskListQuery,
  TaskStatus,
  TaskUserRecord,
  UpdateTaskStatusInput,
} from "../src/domains/task/task-repository.js";
import {
  TaskDomainError,
  TaskService,
  type CreateTaskInput,
  type RawTaskListQuery,
} from "../src/domains/task/task-service.js";

const VALID_INPUT: CreateTaskInput = {
  title: "  完成 Phase 4 设计  ",
  description: "  完成 Task Domain Layer 的验收。  ",
  priority: " HIGH ",
  dueTime: "2026-07-23T16:30:00+08:00",
  timezone: " Asia/Shanghai ",
  tags: [" 项目 ", "MCP", "项目"],
  author: "L",
};

test("Task MCP creation forwards one normalized durable idempotency claim", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);
  const first = await service.createTaskIdempotently(
    { userId: "user-1" },
    VALID_INPUT,
    "task-client-request-0001",
  );
  assert.equal(first.task.id, "00000000-0000-4000-8000-000000000010");
  assert.equal(repository.idempotentWrites.length, 1);
  assert.equal(repository.idempotentWrites[0]?.idempotencyKey, "task-client-request-0001");
  assert.match(repository.idempotentWrites[0]?.requestHash ?? "", /^[a-f0-9]{64}$/);

  repository.idempotentOutcome = "conflict";
  await assert.rejects(
    service.createTaskIdempotently({ userId: "user-1" }, VALID_INPUT, "task-client-request-0001"),
    (error: unknown) => error instanceof TaskDomainError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

class MockTaskRepository implements TaskRepository {
  user: TaskUserRecord | null = { status: "active" };
  findUserCalls: string[] = [];
  writes: NormalizedTaskCreate[] = [];
  idempotentWrites: Array<NormalizedTaskCreate & { idempotencyKey: string; requestHash: string }> = [];
  idempotentOutcome: "created" | "replayed" | "conflict" = "created";
  statusWrites: UpdateTaskStatusInput[] = [];
  statusWriteConflict = false;
  updateWrites: NormalizedTaskUpdate[] = [];
  listQueries: TaskListQuery[] = [];
  records = new Map<string, { userId: string; task: TaskRecord }>();
  lifecycleWrites: Array<["archive" | "restore", string]> = [];

  async findUserById(userId: string): Promise<TaskUserRecord | null> {
    this.findUserCalls.push(userId);
    return this.user;
  }

  async findUserTimezone(): Promise<string | null> {
    return "Asia/Shanghai";
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
      author: input.author,
    };

    this.records.set(task.id, { userId: input.userId, task });
    return task;
  }

  async createTaskIdempotently(input: NormalizedTaskCreate & { idempotencyKey: string; requestHash: string }) {
    this.idempotentWrites.push(input);
    const task = await this.createTask(input);
    return this.idempotentOutcome === "conflict"
      ? { outcome: "conflict" as const }
      : { outcome: this.idempotentOutcome, task };
  }

  async findTasks(userId: string, _limit: number, query: TaskListQuery = {}): Promise<TaskRecord[]> {
    this.listQueries.push(query);
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
    if (this.statusWriteConflict) return null;
    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId) return null;
    record.task = {
      ...record.task,
      status: input.status,
      resumeStatus: input.resumeStatus ?? null,
      completedAt: input.completedAt,
      updatedAt: new Date("2026-07-22T10:00:00.000Z"),
    };
    return record.task;
  }

  async reopenTask(input: { userId: string; id: string; expectedStatus: "completed" | "cancelled"; resumeStatus: "pending" | "in_progress" }): Promise<TaskRecord | null> {
    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId || record.task.lifecycleStatus === "archived" || record.task.status !== input.expectedStatus || record.task.resumeStatus !== input.resumeStatus) return null;
    record.task = { ...record.task, status: input.resumeStatus, resumeStatus: null, completedAt: null, updatedAt: new Date("2026-07-22T10:00:00.000Z") };
    return record.task;
  }

  async updateTask(input: NormalizedTaskUpdate): Promise<TaskRecord | null> {
    this.updateWrites.push(input);
    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId) return null;
    record.task = {
      ...record.task,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.dueTime === undefined ? {} : { dueTime: input.dueTime }),
      ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      updatedAt: new Date("2026-07-22T10:00:00.000Z"),
      author: input.author ?? record.task.author ?? null,
    };
    return record.task;
  }

  async findArchivedTasks(userId: string): Promise<TaskRecord[]> {
    return [...this.records.values()].filter((record) => record.userId === userId && record.task.lifecycleStatus === "archived").map((record) => record.task);
  }

  async findArchivedTaskById(userId: string, id: string): Promise<TaskRecord | null> {
    const record = this.records.get(id);
    return record?.userId === userId && record.task.lifecycleStatus === "archived" ? record.task : null;
  }

  async archiveTask(input: { userId: string; id: string }): Promise<boolean> {
    this.lifecycleWrites.push(["archive", input.id]);
    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId || record.task.lifecycleStatus !== "active") return false;
    record.task = { ...record.task, lifecycleStatus: "archived" };
    return true;
  }

  async restoreTask(input: { userId: string; id: string }): Promise<boolean> {
    this.lifecycleWrites.push(["restore", input.id]);
    const record = this.records.get(input.id);
    if (!record || record.userId !== input.userId || record.task.lifecycleStatus !== "archived") return false;
    record.task = { ...record.task, lifecycleStatus: "active" };
    return true;
  }
}

test("Task archive and restore preserve business status and use active user validation", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);
  const created = await service.createTask({ userId: "user-1" }, VALID_INPUT);
  const record = repository.records.get(created.task.id)!;
  record.task = { ...record.task, status: "completed", completedAt: new Date("2026-07-22T12:00:00.000Z"), lifecycleStatus: "active" };
  await service.archiveTask({ userId: "user-1", id: created.task.id });
  assert.equal(record.task.lifecycleStatus, "archived");
  assert.equal(record.task.status, "completed");
  assert.equal(record.task.completedAt?.toISOString(), "2026-07-22T12:00:00.000Z");
  await service.restoreTask({ userId: "user-1", id: created.task.id });
  assert.equal(record.task.lifecycleStatus, "active");
  assert.equal(record.task.status, "completed");
  repository.user = { status: "disabled" };
  await assert.rejects(service.archiveTask({ userId: "user-1", id: created.task.id }), (error: unknown) => error instanceof TaskDomainError && error.code === "USER_DISABLED");
});

for (const userState of ["missing", "disabled"] as const) {
  test(`Task lifecycle rejects ${userState} users before repository mutation`, async () => {
    const repository = new MockTaskRepository();
    repository.user =
      userState === "missing" ? null : { status: "disabled" };
    const service = new TaskService(repository);
    await assert.rejects(
      service.archiveTask({ userId: "user-1", id: "task-1" }),
      (error: unknown) =>
        error instanceof TaskDomainError &&
        error.code === (
          userState === "missing" ? "USER_NOT_FOUND" : "USER_DISABLED"
        ),
    );
    assert.deepEqual(repository.lifecycleWrites, []);
  });
}

test("Task repeated and cross-user lifecycle mutations return safe TASK_NOT_FOUND", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);
  const owned = seedTask(repository);
  owned.lifecycleStatus = "active";
  const other = seedTask(repository, "pending", "other-user");
  other.id = "other-task";
  repository.records.set(owned.id, { userId: "user-1", task: owned });
  repository.records.set(other.id, { userId: "other-user", task: other });

  await service.archiveTask({ userId: "user-1", id: owned.id });
  await assert.rejects(
    service.archiveTask({ userId: "user-1", id: owned.id }),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "TASK_NOT_FOUND",
  );
  await assert.rejects(
    service.archiveTask({ userId: "user-1", id: other.id }),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "TASK_NOT_FOUND",
  );
  await service.restoreTask({ userId: "user-1", id: owned.id });
  await assert.rejects(
    service.restoreTask({ userId: "user-1", id: owned.id }),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "TASK_NOT_FOUND",
  );
  await assert.rejects(
    service.restoreTask({ userId: "user-1", id: other.id }),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "TASK_NOT_FOUND",
  );
});

test("normalizes Task list search filters before repository access", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);
  await service.listTasks({ userId: "user-1", query: { q: "  REPORT  ", status: "pending", priority: "HIGH", tag: " work ", due: "custom", dueFrom: "2026-07-22T00:00:00Z", dueTo: "2026-07-23T00:00:00Z" } satisfies RawTaskListQuery });
  assert.equal(repository.listQueries[0]?.q, "REPORT");
  assert.equal(repository.listQueries[0]?.status, "pending");
  assert.equal(repository.listQueries[0]?.priority, "high");
  assert.equal(repository.listQueries[0]?.tag, "work");
  assert.equal(repository.listQueries[0]?.dueFrom?.toISOString(), "2026-07-22T00:00:00.000Z");
});

test("rejects invalid task list date filters safely", async () => {
  const service = new TaskService(new MockTaskRepository());
  for (const query of [{ due: "custom" }, { due: "custom", dueFrom: "2026-07-23T00:00:00Z", dueTo: "2026-07-22T00:00:00Z" }]) {
    await assert.rejects(service.listTasks({ userId: "user-1", query }), (error: unknown) => error instanceof TaskDomainError && error.code === "INVALID_TASK_QUERY");
  }
});

test("uses the existing default list behavior when no task query is supplied", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);

  await service.listTasks({ userId: "user-1" });

  assert.deepEqual(repository.findUserCalls, ["user-1"]);
  assert.deepEqual(repository.listQueries, [{}]);
});

test("normalizes literal search, status, priority, and exact tag filters", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);

  await service.listTasks({
    userId: "user-1",
    query: {
      q: "  100%_\\ Report  ",
      status: "IN_PROGRESS",
      priority: "URGENT",
      tag: "  work  ",
    },
  });

  assert.deepEqual(repository.listQueries[0], {
    q: "100%_\\ Report",
    status: "in_progress",
    priority: "urgent",
    tag: "work",
  });
});

test("normalizes all due presets from account-timezone boundaries", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(
    repository,
    () => new Date("2026-07-22T12:00:00.000Z"),
  );

  await service.listTasks({
    userId: "user-1",
    query: {
      due: "today",
    },
  });
  assert.equal(
    repository.listQueries[0]?.dueFrom?.toISOString(),
    "2026-07-21T16:00:00.000Z",
  );
  assert.equal(
    repository.listQueries[0]?.dueTo?.toISOString(),
    "2026-07-22T16:00:00.000Z",
  );

  await service.listTasks({
    userId: "user-1",
    query: {
      due: "next_7_days",
    },
  });
  assert.equal(
    repository.listQueries[1]?.dueFrom?.toISOString(),
    "2026-07-22T16:00:00.000Z",
  );
  assert.equal(
    repository.listQueries[1]?.dueTo?.toISOString(),
    "2026-07-29T16:00:00.000Z",
  );

  await service.listTasks({ userId: "user-1", query: { due: "overdue" } });
  assert.ok(repository.listQueries[2]?.overdueBefore instanceof Date);
  assert.equal(
    repository.listQueries[2]?.overdueBefore?.toISOString(),
    "2026-07-21T16:00:00.000Z",
  );

  await service.listTasks({
    userId: "user-1",
    query: { due: "no_due_date" },
  });
  assert.equal(repository.listQueries[3]?.withoutDueTime, true);
});

test("rejects invalid task list filter values and ambiguous due ranges", async () => {
  const service = new TaskService(new MockTaskRepository());
  const invalidQueries: RawTaskListQuery[] = [
    { q: "x".repeat(201) },
    { tag: "x".repeat(51) },
    { status: "archived" },
    { priority: "critical" },
    { due: "tomorrow" },
    { due: "overdue", dueFrom: "2026-07-22T00:00:00Z" },
    { due: "next_7_days", dueTo: "2026-07-29T00:00:00Z" },
    { due: "custom", dueFrom: "not-an-instant" },
    { dueFrom: "2026-07-22T00:00:00Z" },
    { due: "no_due_date", dueFrom: "2026-07-22T00:00:00Z" },
  ];

  for (const query of invalidQueries) {
    await assert.rejects(
      service.listTasks({ userId: "user-1", query }),
      (error: unknown) =>
        error instanceof TaskDomainError &&
        [
          "INVALID_TASK_QUERY",
          "INVALID_TASK_STATUS",
          "INVALID_PRIORITY",
          "INVALID_DUE_TIME",
        ].includes(error.code),
    );
  }
});

test("accepts one-sided custom task due ranges and keeps inclusive-exclusive bounds", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);

  await service.listTasks({
    userId: "user-1",
    query: { due: "custom", dueFrom: "2026-07-22T00:00:00Z" },
  });
  assert.equal(
    repository.listQueries[0]?.dueFrom?.toISOString(),
    "2026-07-22T00:00:00.000Z",
  );
  assert.equal(repository.listQueries[0]?.dueTo, undefined);

  await service.listTasks({
    userId: "user-1",
    query: { due: "custom", dueTo: "2026-07-23T00:00:00Z" },
  });
  assert.equal(repository.listQueries[1]?.dueFrom, undefined);
  assert.equal(
    repository.listQueries[1]?.dueTo?.toISOString(),
    "2026-07-23T00:00:00.000Z",
  );
});

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
    resumeStatus: status === "completed" ? "in_progress" : status === "cancelled" ? "pending" : null,
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
    author: "L",
  });
  assert.equal(result.task.status, "pending");
  assert.equal(result.task.completed_at, null);
  assert.equal(result.task.due_time, "2026-07-23T08:30:00.000Z");
  assert.equal(result.task.author, "L");
});

for (const author of [undefined, "X"] as const) {
  test("Task create rejects missing or invalid author before persistence", async () => {
    const repository = new MockTaskRepository();
    const service = new TaskService(repository);
    await assert.rejects(
      service.createTask(
        { userId: "user-1" },
        { ...VALID_INPUT, author: author as any },
      ),
      (error: unknown) =>
        error instanceof TaskDomainError && error.code === "AUTHOR_REQUIRED",
    );
    assert.equal(repository.writes.length, 0);
  });
}

test("Task legacy-null edits require an author while authored edits preserve or switch it", async () => {
  const repository = new MockTaskRepository();
  const legacy = seedTask(repository, "pending");
  legacy.author = null;
  const service = new TaskService(repository);
  const base = {
    userId: "user-1",
    id: legacy.id,
    title: "新标题",
    description: "新正文",
    priority: "normal",
    dueTime: null,
    timezone: "Asia/Shanghai",
    tags: [],
  };
  await assert.rejects(
    service.updateWebTask(base),
    (error: unknown) =>
      error instanceof TaskDomainError && error.code === "AUTHOR_REQUIRED",
  );
  assert.equal(repository.updateWrites.length, 0);
  await service.updateWebTask({ ...base, author: "G" });
  assert.equal(repository.records.get(legacy.id)?.task.author, "G");

  const authored = seedTask(repository, "pending");
  authored.id = "authored-task";
  authored.author = "L";
  repository.records.set(authored.id, { userId: "user-1", task: authored });
  await service.updateWebTask({ ...base, id: authored.id });
  assert.equal(repository.records.get(authored.id)?.task.author, "L");
  await service.updateWebTask({ ...base, id: authored.id, author: "G" });
  assert.equal(repository.records.get(authored.id)?.task.author, "G");
});

test("Task MCP partial update forwards only supplied fields and returns fresh detail", async () => {
  const repository = new MockTaskRepository();
  const task = seedTask(repository, "in_progress");
  task.author = "L";
  const service = new TaskService(repository);

  const result = await service.updateMcpTask(
    { userId: "user-1" },
    { id: " task-1 ", description: " Updated description ", dueTime: null, author: "G" },
  );

  assert.deepEqual(repository.updateWrites, [{
    userId: "user-1",
    id: "task-1",
    description: "Updated description",
    dueTime: null,
    author: "G",
  }]);
  assert.equal(result.title, "原任务");
  assert.equal(result.description, "Updated description");
  assert.equal(result.due_time, null);
  assert.equal(result.priority, "normal");
  assert.equal(result.author, "G");
  assert.equal(result.status, "in_progress");
});

test("Task MCP partial update rejects an empty patch before mutation", async () => {
  const repository = new MockTaskRepository();
  seedTask(repository);
  const service = new TaskService(repository);

  await assert.rejects(
    service.updateMcpTask({ userId: "user-1" }, { id: "task-1" }),
    (error: unknown) => error instanceof TaskDomainError && error.code === "INVALID_TASK_PATCH",
  );
  assert.equal(repository.updateWrites.length, 0);
});

test("Task status and lifecycle mutations preserve the stored author", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);
  const task = seedTask(repository, "pending");
  task.author = "L";
  task.lifecycleStatus = "active";
  await service.updateWebTaskStatus({ userId: "user-1", id: task.id, status: "in_progress" });
  assert.equal(repository.records.get(task.id)?.task.author, "L");
  await service.updateWebTaskStatus({ userId: "user-1", id: task.id, status: "cancelled" });
  assert.equal(repository.records.get(task.id)?.task.author, "L");
  await service.reopenTask({ userId: "user-1", id: task.id });
  assert.equal(repository.records.get(task.id)?.task.author, "L");
  await service.archiveTask({ userId: "user-1", id: task.id });
  assert.equal(repository.records.get(task.id)?.task.author, "L");
  await service.restoreTask({ userId: "user-1", id: task.id });
  assert.equal(repository.records.get(task.id)?.task.author, "L");
});

test("creates a task without a due date in the account timezone", async () => {
  const repository = new MockTaskRepository();
  const service = new TaskService(repository);

  const result = await service.createTask(
    { userId: "user-1" },
    { ...VALID_INPUT, dueTime: null, timezone: undefined },
  );

  assert.equal(repository.writes[0]?.dueTime, null);
  assert.equal(repository.writes[0]?.timezone, "Asia/Shanghai");
  assert.equal(result.task.due_time, null);
  assert.equal(result.task.time_bucket, "no_due_date");
});

test("edits between a UTC due instant and no due date without changing status", async () => {
  const repository = new MockTaskRepository();
  seedTask(repository, "in_progress");
  const service = new TaskService(repository);

  const withoutDue = await service.updateWebTask({
    userId: "user-1",
    id: "task-1",
    ...VALID_INPUT,
    dueTime: null,
  });
  assert.equal(withoutDue.due_time, null);
  assert.equal(withoutDue.status, "in_progress");

  const restored = await service.updateWebTask({
    userId: "user-1",
    id: "task-1",
    ...VALID_INPUT,
    dueTime: "2026-07-25T09:00",
  });
  assert.equal(restored.due_time, "2026-07-25T01:00:00.000Z");
  assert.equal(restored.status, "in_progress");
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

test("accepts account-local time and rejects relative or invalid calendar times", async () => {
  const localRepository = new MockTaskRepository();
  await new TaskService(localRepository).createTask(
    { userId: "user-1" },
    { ...VALID_INPUT, dueTime: "2026-07-23T16:30" },
  );
  assert.equal(
    localRepository.writes[0]?.dueTime?.toISOString(),
    "2026-07-23T08:30:00.000Z",
  );

  const invalidTimes = [
    "明天下午",
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

test("repeated terminal status keeps its reopen target", async () => {
  const repository = new MockTaskRepository();
  seedTask(repository, "completed");
  const service = new TaskService(repository);

  const result = await service.updateWebTaskStatus({
    userId: "user-1",
    id: "task-1",
    status: "completed",
  });

  assert.equal(result.status, "completed");
  assert.equal((repository.records.get("task-1")!.task as TaskRecord & { resumeStatus?: TaskStatus | null }).resumeStatus, "in_progress");
  assert.equal(repository.statusWrites.length, 0);
});

test("cancel and complete retain server-owned reopen targets", async () => {
  for (const [from, terminal, expectedResume] of [
    ["pending", "cancelled", "pending"],
    ["in_progress", "cancelled", "in_progress"],
    ["in_progress", "completed", "in_progress"],
  ] as const) {
    const repository = new MockTaskRepository();
    seedTask(repository, from);
    const service = new TaskService(repository);

    await service.updateWebTaskStatus({ userId: "user-1", id: "task-1", status: terminal });
    const stored = repository.records.get("task-1")!.task as TaskRecord & { resumeStatus?: TaskStatus | null };
    assert.equal(stored.status, terminal);
    assert.equal(stored.resumeStatus, expectedResume);
    assert.equal(stored.completedAt === null, terminal !== "completed");

    const reopen = (service as unknown as {
      reopenTask(input: { userId: string; id: string }): Promise<{ status: TaskStatus; completed_at: string | null }>;
    }).reopenTask;
    const result = await reopen.call(service, { userId: "user-1", id: "task-1" });
    assert.equal(result.status, from);
    assert.equal(result.completed_at, null);
    assert.equal((repository.records.get("task-1")!.task as TaskRecord & { resumeStatus?: TaskStatus | null }).resumeStatus, null);
  }
});

test("reopen rejects active tasks, invalid terminal state, and disabled users", async () => {
  const activeRepository = new MockTaskRepository();
  seedTask(activeRepository, "pending");
  const activeService = new TaskService(activeRepository);
  const reopen = (activeService as unknown as { reopenTask(input: { userId: string; id: string }): Promise<unknown> }).reopenTask;
  await assert.rejects(
    reopen.call(activeService, { userId: "user-1", id: "task-1" }),
    (error: unknown) => error instanceof TaskDomainError && error.code === "INVALID_TASK_REOPEN_STATE",
  );

  const invalidRepository = new MockTaskRepository();
  seedTask(invalidRepository, "completed");
  const invalidRecord = invalidRepository.records.get("task-1")!.task as TaskRecord & { resumeStatus?: TaskStatus | null };
  invalidRecord.resumeStatus = "completed" as TaskStatus;
  const invalidService = new TaskService(invalidRepository);
  const invalidReopen = (invalidService as unknown as { reopenTask(input: { userId: string; id: string }): Promise<unknown> }).reopenTask;
  await assert.rejects(
    invalidReopen.call(invalidService, { userId: "user-1", id: "task-1" }),
    (error: unknown) => error instanceof TaskDomainError && error.code === "INVALID_TASK_REOPEN_STATE",
  );

  invalidRepository.user = { status: "disabled" };
  await assert.rejects(
    invalidReopen.call(invalidService, { userId: "user-1", id: "task-1" }),
    (error: unknown) => error instanceof TaskDomainError && error.code === "USER_DISABLED",
  );
});

test("concurrent status mutation is reported as a conflict rather than not found", async () => {
  const repository = new MockTaskRepository();
  seedTask(repository, "pending");
  repository.statusWriteConflict = true;
  const service = new TaskService(repository);

  await assert.rejects(
    service.updateWebTaskStatus({ userId: "user-1", id: "task-1", status: "in_progress" }),
    (error: unknown) => error instanceof TaskDomainError && error.code === "TASK_STATUS_CONFLICT",
  );
});

test("returns the domain-approved actions for each task state", async () => {
  const cases: Array<[TaskStatus, string[]]> = [
    ["pending", ["start", "cancel"]],
    ["in_progress", ["complete", "cancel"]],
    ["completed", ["reopen"]],
    ["cancelled", ["reopen"]],
  ];

  for (const [status, expectedActions] of cases) {
    const repository = new MockTaskRepository();
    seedTask(repository, status);
    const service = new TaskService(repository);

    const result = await service.readTask({ userId: "user-1", id: "task-1" });
    assert.deepEqual(result.allowed_actions, expectedActions);
  }
});

test("archived tasks never expose lifecycle actions", async () => {
  for (const status of ["pending", "in_progress", "completed", "cancelled"] as const) {
    const repository = new MockTaskRepository();
    const task = seedTask(repository, status);
    task.lifecycleStatus = "archived";
    const service = new TaskService(repository);

    const result = await service.readTask({ userId: "user-1", id: task.id });
    assert.deepEqual(result.allowed_actions, []);
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
    author: "L",
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
