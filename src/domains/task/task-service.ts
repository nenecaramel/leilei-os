import type {
  NormalizedTaskCreate,
  NormalizedTaskFields,
  NormalizedTaskUpdate,
  TaskPriority,
  TaskRecord,
  TaskRepository,
  TaskListQuery,
  TaskStatus,
} from "./task-repository.js";
import {
  hashMcpWriteRequest,
  normalizeMcpIdempotencyKey,
} from "../mcp-write/mcp-write-idempotency.js";
import { WEB_USER_LIFECYCLE_CONTEXT } from "../lifecycle/lifecycle-audit-repository.js";
import {
  TaskStateTransitionError,
  assertTaskStatusTransition,
  getAllowedTaskActions,
  type TaskAction,
} from "./task-state-machine.js";
import {
  classifyTaskDueTime,
  DEFAULT_ACCOUNT_TIMEZONE,
  getTaskTimeBoundaries,
  normalizeIanaTimezone,
  parseTaskDueTime,
  type TaskTimeBucket,
} from "./task-time.js";
import {
  isContentAuthor,
  type ContentAuthor,
} from "../content-author.js";
import {
  TASK_DESCRIPTION_MAX_LENGTH,
  TASK_TAGS_MAX_COUNT,
  TASK_TAG_MAX_LENGTH,
  TASK_TIMEZONE_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
} from "../resource-limits.js";

const ALLOWED_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const satisfies readonly TaskPriority[];

const ALLOWED_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
] as const satisfies readonly TaskStatus[];

const MAX_TITLE_LENGTH = TASK_TITLE_MAX_LENGTH;
const MAX_DESCRIPTION_LENGTH = TASK_DESCRIPTION_MAX_LENGTH;
const MAX_TAGS = TASK_TAGS_MAX_COUNT;
const MAX_TAG_LENGTH = TASK_TAG_MAX_LENGTH;
const MAX_TIMEZONE_LENGTH = TASK_TIMEZONE_MAX_LENGTH;
const DEFAULT_TASK_LIMIT = 100;
const MAX_TASK_LIMIT = 100;
const MAX_SEARCH_LENGTH = 200;

export type AuthenticatedTaskContext = {
  userId: string;
};

export type CreateTaskInput = {
  title: string;
  description: string;
  priority: string;
  dueTime?: string | null;
  timezone?: string;
  tags: readonly string[];
  author?: ContentAuthor;
};

export type TaskEntryResult = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_time: string | null;
  timezone: string;
  time_bucket: TaskTimeBucket;
  tags: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  allowed_actions: TaskAction[];
  lifecycle_status?: "active" | "archived";
  author: ContentAuthor | null;
};

export type CreateTaskResult = {
  task: TaskEntryResult;
};

export type ListTasksInput = {
  userId: string;
  limit?: number;
  query?: RawTaskListQuery;
  offset?: number;
};

export type RawTaskListQuery = {
  q?: string;
  status?: string;
  priority?: string;
  tag?: string;
  due?: string;
  dueFrom?: string;
  dueTo?: string;
};

export type ListTasksResult = {
  tasks: TaskEntryResult[];
  metadata: {
    count: number;
  };
};

export type ReadTaskInput = {
  userId: string;
  id: string;
};

export type CreateWebTaskInput = {
  userId: string;
  title: string;
  description: string;
  priority: string;
  dueTime?: string | null;
  timezone?: string;
  tags?: readonly string[];
  author?: ContentAuthor;
};

export type UpdateWebTaskStatusInput = {
  userId: string;
  id: string;
  status: string;
};

export type UpdateWebTaskInput = {
  userId: string;
  id: string;
  title: string;
  description: string;
  priority: string;
  dueTime?: string | null;
  timezone?: string;
  tags?: readonly string[];
  author?: ContentAuthor;
};

export type UpdateMcpTaskInput = {
  id: string;
  title?: string;
  description?: string;
  priority?: string;
  dueTime?: string | null;
  tags?: readonly string[];
  author?: ContentAuthor;
};

export type TransitionMcpTaskInput = {
  id: string;
  action: TaskAction;
};

export type TaskDomainErrorCode =
  | "AUTHOR_REQUIRED"
  | "INVALID_AUTHENTICATED_USER"
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "TASK_NOT_FOUND"
  | "INVALID_TASK_LIMIT"
  | "INVALID_TASK_QUERY"
  | "INVALID_TITLE"
  | "INVALID_DESCRIPTION"
  | "INVALID_PRIORITY"
  | "INVALID_TASK_STATUS"
  | "INVALID_TASK_STATUS_TRANSITION"
  | "INVALID_TASK_REOPEN_STATE"
  | "TASK_STATUS_CONFLICT"
  | "INVALID_DUE_TIME"
  | "INVALID_TIMEZONE"
  | "INVALID_TAGS"
  | "INVALID_TASK_PATCH"
  | "INVALID_IDEMPOTENCY_KEY"
  | "IDEMPOTENCY_CONFLICT";

export class TaskDomainError extends Error {
  constructor(
    readonly code: TaskDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskDomainError";
  }
}

export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createTask(
    context: AuthenticatedTaskContext,
    input: CreateTaskInput,
  ): Promise<CreateTaskResult> {
    const userId = await this.requireActiveUser(context.userId);
    const timezone = await this.getAccountTimezone(userId);
    const normalized = this.normalizeInput(userId, input, timezone);
    const task = await this.repository.createTask(normalized);

    return {
      task: this.toTaskResult(task, timezone),
    };
  }

  async createTaskIdempotently(
    context: AuthenticatedTaskContext,
    input: CreateTaskInput,
    idempotencyKey: string,
  ): Promise<CreateTaskResult> {
    const userId = await this.requireActiveUser(context.userId);
    const timezone = await this.getAccountTimezone(userId);
    const normalized = this.normalizeInput(userId, input, timezone);
    const repository = this.repository.createTaskIdempotently;

    if (!repository) {
      throw new Error("Task idempotency persistence is unavailable.");
    }

    let normalizedKey: string;
    try {
      normalizedKey = normalizeMcpIdempotencyKey(idempotencyKey);
    } catch {
      throw new TaskDomainError(
        "INVALID_IDEMPOTENCY_KEY",
        "The idempotency key is invalid.",
      );
    }

    const requestHash = hashMcpWriteRequest({
      title: normalized.title,
      description: normalized.description,
      status: normalized.status,
      priority: normalized.priority,
      due_time: normalized.dueTime?.toISOString() ?? null,
      timezone: normalized.timezone,
      tags: normalized.tags,
      completed_at: null,
      author: normalized.author,
    });

    const persisted = await repository.call(this.repository, {
      ...normalized,
      idempotencyKey: normalizedKey,
      requestHash,
    });

    if (persisted.outcome === "conflict") {
      throw new TaskDomainError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key was already used for a different task.",
      );
    }

    return { task: this.toTaskResult(persisted.task, timezone) };
  }

  async listTasks(
    input: ListTasksInput,
  ): Promise<ListTasksResult> {
    const userId = await this.requireActiveUser(input.userId);
    const limit = this.resolveLimit(input.limit);
    const timezone = await this.getAccountTimezone(userId);

    const query = this.normalizeListQuery(input.query ?? {}, timezone);
    const tasks = await this.repository.findTasks(userId, limit, query, input.offset);

    return {
      tasks: tasks.map((task) =>
        this.toTaskResult(task, timezone),
      ),
      metadata: {
        count: tasks.length,
      },
    };
  }

  async readTask(
    input: ReadTaskInput,
  ): Promise<TaskEntryResult> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();

    if (!id) {
      throw new TaskDomainError(
        "TASK_NOT_FOUND",
        "Task was not found.",
      );
    }

    const task = await this.repository.findTaskById(
      userId,
      id,
    );

    if (!task) {
      throw new TaskDomainError(
        "TASK_NOT_FOUND",
        "Task was not found.",
      );
    }

    return this.toTaskResult(task, await this.getAccountTimezone(userId));
  }

  async listArchivedTasks(input: { userId: string; limit?: number }): Promise<ListTasksResult> {
    const userId = await this.requireActiveUser(input.userId);
    const repository = this.repository.findArchivedTasks;
    if (!repository) throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    const timezone = await this.getAccountTimezone(userId);
    const tasks = await repository.call(this.repository, userId, this.resolveLimit(input.limit));
    return { tasks: tasks.map((task) => this.toTaskResult(task, timezone)), metadata: { count: tasks.length } };
  }

  async readArchivedTask(input: { userId: string; id: string }): Promise<TaskEntryResult> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();
    const repository = this.repository.findArchivedTaskById;
    if (!id || !repository) throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    const task = await repository.call(this.repository, userId, id);
    if (!task) throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    return this.toTaskResult(task, await this.getAccountTimezone(userId));
  }

  async archiveTask(input: { userId: string; id: string }): Promise<void> {
    const userId = await this.requireActiveUser(input.userId);
    const repository = this.repository.archiveTask;
    if (!input.id.trim() || !repository || !(await repository.call(this.repository, { id: input.id.trim(), userId, ...WEB_USER_LIFECYCLE_CONTEXT }))) {
      throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    }
  }

  async restoreTask(input: { userId: string; id: string }): Promise<void> {
    const userId = await this.requireActiveUser(input.userId);
    const repository = this.repository.restoreTask;
    if (!input.id.trim() || !repository || !(await repository.call(this.repository, { id: input.id.trim(), userId, ...WEB_USER_LIFECYCLE_CONTEXT }))) {
      throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    }
  }

  async permanentlyDeleteTask(input: { userId: string; id: string }): Promise<void> {
    const userId = await this.requireActiveUser(input.userId);
    const repository = this.repository.permanentlyDeleteTask;
    const id = input.id.trim();
    if (!id || !repository || !(await repository.call(this.repository, {
      id,
      userId,
      ...WEB_USER_LIFECYCLE_CONTEXT,
    }))) {
      throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    }
  }

  async createWebTask(
    input: CreateWebTaskInput,
  ): Promise<TaskEntryResult> {
    const result = await this.createTask(
      {
        userId: input.userId,
      },
      {
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueTime: input.dueTime,
        timezone: input.timezone,
        tags: input.tags ?? [],
        author: input.author,
      },
    );

    return result.task;
  }

  async updateWebTaskStatus(
    input: UpdateWebTaskStatusInput,
  ): Promise<TaskEntryResult> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();

    if (!id) {
      throw new TaskDomainError(
        "TASK_NOT_FOUND",
        "Task was not found.",
      );
    }

    const status = this.normalizeStatus(input.status);

    const existing = await this.repository.findTaskById(
      userId,
      id,
    );

    if (!existing) {
      throw new TaskDomainError(
        "TASK_NOT_FOUND",
        "Task was not found.",
      );
    }

    try {
      assertTaskStatusTransition(existing.status, status);
    } catch (error) {
      if (error instanceof TaskStateTransitionError) {
        throw new TaskDomainError(
          "INVALID_TASK_STATUS_TRANSITION",
          error.message,
        );
      }
      throw error;
    }

    if (existing.status === status) {
      return this.toTaskResult(
        existing,
        await this.getAccountTimezone(userId),
      );
    }

    const task = await this.repository.updateTaskStatus({
      userId,
      id,
      status,
      expectedStatus: existing.status,
      resumeStatus:
        status === "completed" || status === "cancelled"
          ? existing.status === "pending" || existing.status === "in_progress"
            ? existing.status
            : null
          : null,
      completedAt:
        status === "completed"
          ? this.now()
          : null,
    });

    if (!task) {
      const current = await this.repository.findTaskById(userId, id);
      throw new TaskDomainError(
        current ? "TASK_STATUS_CONFLICT" : "TASK_NOT_FOUND",
        current ? "Task status changed concurrently." : "Task was not found.",
      );
    }

    return this.toTaskResult(task, await this.getAccountTimezone(userId));
  }

  async reopenTask(input: { userId: string; id: string }): Promise<TaskEntryResult> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();
    if (!id) {
      throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    }

    const existing = await this.repository.findTaskById(userId, id);
    if (!existing) {
      throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    }
    if (existing.status !== "completed" && existing.status !== "cancelled") {
      throw new TaskDomainError(
        "INVALID_TASK_REOPEN_STATE",
        "Only completed or cancelled tasks can be reopened.",
      );
    }

    const resumeStatus = existing.resumeStatus;
    if (resumeStatus !== "pending" && resumeStatus !== "in_progress") {
      throw new TaskDomainError(
        "INVALID_TASK_REOPEN_STATE",
        "The task has no valid active status to restore.",
      );
    }

    const task = await this.repository.reopenTask({
      userId,
      id,
      expectedStatus: existing.status,
      resumeStatus,
    });
    if (!task) {
      const current = await this.repository.findTaskById(userId, id);
      throw new TaskDomainError(
        current ? "TASK_STATUS_CONFLICT" : "TASK_NOT_FOUND",
        current ? "Task status changed concurrently." : "Task was not found.",
      );
    }

    return this.toTaskResult(task, await this.getAccountTimezone(userId));
  }

  async updateWebTask(
    input: UpdateWebTaskInput,
  ): Promise<TaskEntryResult> {
    const userId = await this.requireActiveUser(input.userId);
    const id = input.id.trim();

    if (!id) {
      throw new TaskDomainError(
        "TASK_NOT_FOUND",
        "Task was not found.",
      );
    }

    const existing = await this.repository.findTaskById(
      userId,
      id,
    );

    if (!existing) {
      throw new TaskDomainError(
        "TASK_NOT_FOUND",
        "Task was not found.",
      );
    }

    const accountTimezone = await this.getAccountTimezone(userId);
    const normalized = this.normalizeTaskFields({
      title: input.title,
      description: input.description,
      priority: input.priority,
      dueTime: input.dueTime,
      timezone: input.timezone,
      tags: input.tags ?? [],
    }, accountTimezone);
    const author = this.requireAuthor(input.author ?? existing.author ?? null);

    const task = await this.repository.updateTask({
      userId,
      id,
      ...normalized,
      author,
    });

    if (!task) {
      throw new TaskDomainError(
        "TASK_NOT_FOUND",
        "Task was not found.",
      );
    }

    return this.toTaskResult(task, accountTimezone);
  }

  async updateMcpTask(
    context: AuthenticatedTaskContext,
    input: UpdateMcpTaskInput,
  ): Promise<TaskEntryResult> {
    const userId = await this.requireActiveUser(context.userId);
    const id = input.id.trim();
    if (!id) {
      throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    }
    const accountTimezone = await this.getAccountTimezone(userId);
    let hasPatch = false;
    const patch: Omit<NormalizedTaskUpdate, "userId" | "id"> = {};
    if (input.title !== undefined) {
      patch.title = this.normalizeRequiredText(input.title, MAX_TITLE_LENGTH, "INVALID_TITLE", "Task title");
      hasPatch = true;
    }
    if (input.description !== undefined) {
      patch.description = this.normalizeRequiredText(input.description, MAX_DESCRIPTION_LENGTH, "INVALID_DESCRIPTION", "Task description");
      hasPatch = true;
    }
    if (input.priority !== undefined) {
      patch.priority = this.normalizePriority(input.priority);
      hasPatch = true;
    }
    if (input.dueTime !== undefined) {
      patch.dueTime = this.normalizeDueTime(input.dueTime, accountTimezone);
      hasPatch = true;
    }
    if (input.tags !== undefined) {
      patch.tags = this.normalizeTags(input.tags);
      hasPatch = true;
    }
    if (input.author !== undefined) {
      patch.author = this.requireAuthor(input.author);
      hasPatch = true;
    }
    if (!hasPatch) {
      throw new TaskDomainError(
        "INVALID_TASK_PATCH",
        "At least one Task field must be supplied.",
      );
    }
    const task = await this.repository.updateTask({ userId, id, ...patch });
    if (!task) {
      throw new TaskDomainError("TASK_NOT_FOUND", "Task was not found.");
    }
    return this.readTask({ userId, id });
  }

  async transitionMcpTask(
    context: AuthenticatedTaskContext,
    input: TransitionMcpTaskInput,
  ): Promise<TaskEntryResult> {
    const current = await this.readTask({ userId: context.userId, id: input.id });
    if (!current.allowed_actions.includes(input.action)) {
      throw new TaskDomainError(
        input.action === "reopen"
          ? "INVALID_TASK_REOPEN_STATE"
          : "INVALID_TASK_STATUS_TRANSITION",
        input.action === "reopen"
          ? "The task cannot be reopened in its current state."
          : "The task cannot perform that action in its current state.",
      );
    }

    switch (input.action) {
      case "start":
        await this.updateWebTaskStatus({ userId: context.userId, id: input.id, status: "in_progress" });
        break;
      case "complete":
        await this.updateWebTaskStatus({ userId: context.userId, id: input.id, status: "completed" });
        break;
      case "cancel":
        await this.updateWebTaskStatus({ userId: context.userId, id: input.id, status: "cancelled" });
        break;
      case "reopen":
        await this.reopenTask({ userId: context.userId, id: input.id });
        break;
    }

    return this.readTask({ userId: context.userId, id: input.id });
  }

  private async requireActiveUser(
    userId: string,
  ): Promise<string> {
    const normalized =
      this.requireAuthenticatedUserId(userId);

    const user = await this.repository.findUserById(
      normalized,
    );

    if (!user) {
      throw new TaskDomainError(
        "USER_NOT_FOUND",
        "User was not found.",
      );
    }

    if (user.status !== "active") {
      throw new TaskDomainError(
        "USER_DISABLED",
        "User is disabled.",
      );
    }

    return normalized;
  }

  private requireAuthenticatedUserId(
    userId: string,
  ): string {
    const normalized = userId.trim();

    if (normalized.length === 0) {
      throw new TaskDomainError(
        "INVALID_AUTHENTICATED_USER",
        "Authenticated user is required.",
      );
    }

    return normalized;
  }

  private normalizeInput(
    userId: string,
    input: CreateTaskInput,
    accountTimezone: string,
  ): NormalizedTaskCreate {
    return {
      userId,
      ...this.normalizeTaskFields(input, accountTimezone),
      status: "pending",
      completedAt: null,
      author: this.requireAuthor(input.author),
    };
  }

  private requireAuthor(value: unknown): ContentAuthor {
    if (!isContentAuthor(value)) {
      throw new TaskDomainError(
        "AUTHOR_REQUIRED",
        "A content author must be selected.",
      );
    }
    return value;
  }

  private normalizeTaskFields(input: {
    title: string;
    description: string;
    priority: string;
    dueTime?: string | null;
    timezone?: string;
    tags: readonly string[];
  }, accountTimezone: string): NormalizedTaskFields {
    const requestedTimezone = input.timezone
      ? this.normalizeTimezone(input.timezone)
      : accountTimezone;

    const hasAbsoluteDueTime =
      typeof input.dueTime === "string" &&
      /(?:Z|[+-]\d{2}:\d{2})$/.test(input.dueTime.trim());

    if (
      requestedTimezone !== accountTimezone &&
      input.dueTime !== null &&
      input.dueTime !== undefined &&
      !hasAbsoluteDueTime
    ) {
      throw new TaskDomainError(
        "INVALID_TIMEZONE",
        "Task local time must use the account timezone.",
      );
    }

    return {
      title: this.normalizeRequiredText(
        input.title,
        MAX_TITLE_LENGTH,
        "INVALID_TITLE",
        "Task title",
      ),
      description: this.normalizeRequiredText(
        input.description,
        MAX_DESCRIPTION_LENGTH,
        "INVALID_DESCRIPTION",
        "Task description",
      ),
      priority: this.normalizePriority(input.priority),
      dueTime: this.normalizeDueTime(input.dueTime, accountTimezone),
      timezone: accountTimezone,
      tags: this.normalizeTags(input.tags),
    };
  }

  private normalizeRequiredText(
    value: string,
    maxLength: number,
    code: "INVALID_TITLE" | "INVALID_DESCRIPTION",
    label: string,
  ): string {
    const normalized = value.normalize("NFC").trim();

    if (
      normalized.length === 0 ||
      normalized.length > maxLength
    ) {
      throw new TaskDomainError(
        code,
        `${label} must contain between 1 and ${maxLength} characters.`,
      );
    }

    return normalized;
  }

  private normalizePriority(
    priority: string,
  ): TaskPriority {
    const normalized = priority.trim().toLowerCase();
    const allowed = new Set<string>(ALLOWED_PRIORITIES);

    if (!allowed.has(normalized)) {
      throw new TaskDomainError(
        "INVALID_PRIORITY",
        "Task priority must be low, normal, high, or urgent.",
      );
    }

    return normalized as TaskPriority;
  }

  private normalizeStatus(
    status: string,
  ): TaskStatus {
    const normalized = status.trim().toLowerCase();
    const allowed = new Set<string>(ALLOWED_STATUSES);

    if (!allowed.has(normalized)) {
      throw new TaskDomainError(
        "INVALID_TASK_STATUS",
        "Task status must be pending, in_progress, completed, or cancelled.",
      );
    }

    return normalized as TaskStatus;
  }

  private normalizeListQuery(
    input: RawTaskListQuery,
    timezone: string,
  ): TaskListQuery {
    const q = this.normalizeOptionalText(input.q, MAX_SEARCH_LENGTH, "INVALID_TASK_QUERY", "Search query");
    const tag = this.normalizeOptionalText(input.tag, MAX_TAG_LENGTH, "INVALID_TASK_QUERY", "Task tag");
    const status = input.status === undefined || input.status.trim() === "" ? undefined : this.normalizeStatus(input.status);
    const priority = input.priority === undefined || input.priority.trim() === "" ? undefined : this.normalizePriority(input.priority);
    const due = input.due?.trim() || undefined;
    const dueFrom = input.dueFrom === undefined || input.dueFrom.trim() === "" ? undefined : this.normalizeDueTime(input.dueFrom, timezone) ?? undefined;
    const dueTo = input.dueTo === undefined || input.dueTo.trim() === "" ? undefined : this.normalizeDueTime(input.dueTo, timezone) ?? undefined;
    const base: TaskListQuery = {
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(tag ? { tag } : {}),
    };

    if (dueFrom && dueTo && dueFrom >= dueTo) {
      throw new TaskDomainError("INVALID_TASK_QUERY", "Task due range must have a start before its end.");
    }
    if (!due) {
      if (dueFrom || dueTo) throw new TaskDomainError("INVALID_TASK_QUERY", "Task date ranges require a due filter.");
      return base;
    }
    if (due === "no_due_date") {
      if (dueFrom || dueTo) throw new TaskDomainError("INVALID_TASK_QUERY", "Tasks without due dates do not accept a range.");
      return { ...base, withoutDueTime: true };
    }
    if (due === "custom") {
      if (!dueFrom && !dueTo) throw new TaskDomainError("INVALID_TASK_QUERY", "Custom task dates require a range boundary.");
      return { ...base, ...(dueFrom ? { dueFrom } : {}), ...(dueTo ? { dueTo } : {}) };
    }
    if (due === "overdue") {
      if (dueFrom || dueTo) throw new TaskDomainError("INVALID_TASK_QUERY", "Overdue tasks do not accept a range.");
      return {
        ...base,
        overdueBefore: getTaskTimeBoundaries(timezone, this.now()).todayStart,
      };
    }
    if (due === "today" || due === "next_7_days" || due === "later") {
      if (dueFrom || dueTo) throw new TaskDomainError("INVALID_TASK_QUERY", "Task due presets use account-timezone boundaries and do not accept a range.");
      const boundaries = getTaskTimeBoundaries(timezone, this.now());
      if (due === "today") return { ...base, dueFrom: boundaries.todayStart, dueTo: boundaries.tomorrowStart };
      if (due === "next_7_days") return { ...base, dueFrom: boundaries.tomorrowStart, dueTo: boundaries.eighthDayStart };
      return { ...base, dueFrom: boundaries.eighthDayStart };
    }
    throw new TaskDomainError(
      "INVALID_TASK_QUERY",
      "Task due filter must be no_due_date, overdue, today, next_7_days, later, or custom.",
    );
  }

  private normalizeOptionalText(value: string | undefined, maxLength: number, code: TaskDomainErrorCode, label: string): string | undefined {
    if (value === undefined) return undefined;
    const normalized = value.normalize("NFC").trim();
    if (!normalized) return undefined;
    if (normalized.length > maxLength) throw new TaskDomainError(code, `${label} is too long.`);
    return normalized;
  }

  private normalizeDueTime(
    dueTime: string | null | undefined,
    timezone: string,
  ): Date | null {
    try {
      return parseTaskDueTime(dueTime, timezone);
    } catch {
      throw new TaskDomainError(
        "INVALID_DUE_TIME",
        "Task due time must be null, an exact ISO instant, or a valid local date-time in the account timezone.",
      );
    }
  }

  private normalizeTimezone(
    timezone: string,
  ): string {
    const normalized = timezone.normalize("NFC").trim();

    if (
      normalized.length === 0 ||
      normalized.length > MAX_TIMEZONE_LENGTH
    ) {
      throw new TaskDomainError(
        "INVALID_TIMEZONE",
        "Task timezone is required and is too long.",
      );
    }

    try {
      return normalizeIanaTimezone(normalized);
    } catch {
      throw new TaskDomainError(
        "INVALID_TIMEZONE",
        "Task timezone must be a valid IANA timezone.",
      );
    }

  }

  private async getAccountTimezone(userId: string): Promise<string> {
    const timezone =
      (await this.repository.findUserTimezone(userId)) ??
      DEFAULT_ACCOUNT_TIMEZONE;
    return this.normalizeTimezone(timezone);
  }

  private normalizeTags(
    tags: readonly string[],
  ): string[] {
    if (!Array.isArray(tags)) {
      throw new TaskDomainError(
        "INVALID_TAGS",
        "Task tags must be an array.",
      );
    }

    const normalized = [
      ...new Set(
        tags.map((tag) => {
          const value = tag.normalize("NFC").trim();

          if (
            value.length === 0 ||
            value.length > MAX_TAG_LENGTH
          ) {
            throw new TaskDomainError(
              "INVALID_TAGS",
              `Each task tag must contain between 1 and ${MAX_TAG_LENGTH} characters.`,
            );
          }

          return value;
        }),
      ),
    ];

    if (normalized.length > MAX_TAGS) {
      throw new TaskDomainError(
        "INVALID_TAGS",
        `Tasks may contain at most ${MAX_TAGS} tags.`,
      );
    }

    return normalized;
  }

  private resolveLimit(limit?: number): number {
    if (limit === undefined) {
      return DEFAULT_TASK_LIMIT;
    }

    if (!Number.isInteger(limit) || limit < 1) {
      throw new TaskDomainError(
        "INVALID_TASK_LIMIT",
        "Task limit must be a positive integer.",
      );
    }

    return Math.min(limit, MAX_TASK_LIMIT);
  }

  private toTaskResult(
    task: TaskRecord,
    timezone: string,
  ): TaskEntryResult {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      due_time: task.dueTime?.toISOString() ?? null,
      timezone,
      time_bucket: classifyTaskDueTime(task.dueTime, timezone, this.now()),
      tags: task.tags,
      created_at: task.createdAt.toISOString(),
      updated_at: task.updatedAt.toISOString(),
      completed_at:
        task.completedAt?.toISOString() ?? null,
      author: task.author ?? null,
      allowed_actions:
        task.lifecycleStatus === "archived"
          ? []
          : getAllowedTaskActions(task.status),
      lifecycle_status: task.lifecycleStatus ?? "active",
    };
  }
}
