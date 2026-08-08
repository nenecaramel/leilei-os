import assert from "node:assert/strict";
import test from "node:test";
import type {
  NormalizedTaskCreate,
  NormalizedTaskUpdate,
  ReopenTaskInput,
  TaskListQuery,
  TaskRecord,
  TaskRepository,
  UpdateTaskStatusInput,
} from "../src/domains/task/task-repository.js";
import { TaskService } from "../src/domains/task/task-service.js";
import { getTaskTimeBoundaries } from "../src/domains/task/task-time.js";
import { buildTaskListRequest } from "../web/src/pages/task-list-request.js";
import { EMPTY_TASK_FILTERS, readTaskFilters } from "../web/src/pages/task-location.js";

class Repo implements TaskRepository {
  query: TaskListQuery | undefined;
  async findUserById() { return { status: "active" as const }; }
  async findUserTimezone() { return "Asia/Shanghai"; }
  async findTasks(_u: string, _l: number, query?: TaskListQuery): Promise<TaskRecord[]> { this.query = query; return []; }
  async findTaskById(): Promise<TaskRecord | null> { return null; }
  async createTask(_i: NormalizedTaskCreate): Promise<TaskRecord> { throw new Error("unused"); }
  async updateTaskStatus(_i: UpdateTaskStatusInput): Promise<TaskRecord | null> { throw new Error("unused"); }
  async reopenTask(_i: ReopenTaskInput): Promise<TaskRecord | null> { throw new Error("unused"); }
  async updateTask(_i: NormalizedTaskUpdate): Promise<TaskRecord | null> { throw new Error("unused"); }
}

test("URL/request layer accepts later", () => {
  assert.equal(readTaskFilters("?due=later").due, "later");
  assert.equal(buildTaskListRequest({ ...EMPTY_TASK_FILTERS, due: "later" }).url, "/task?due=later");
});

test("TaskService maps later to eighthDayStart", async () => {
  const repo = new Repo();
  const now = new Date("2026-08-08T03:00:00Z");
  await new TaskService(repo, () => now).listTasks({ userId: "u", query: { due: "later" } });
  const boundaries = getTaskTimeBoundaries("Asia/Shanghai", now);
  assert.equal(repo.query?.dueFrom?.toISOString(), boundaries.eighthDayStart.toISOString());
  assert.equal(repo.query?.dueTo, undefined);
});
