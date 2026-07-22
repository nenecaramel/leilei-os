import type {
  NormalizedTaskCreate,
  TaskPriority,
  TaskRecord,
  TaskRepository,
} from "./task-repository.js";

const ALLOWED_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const satisfies readonly TaskPriority[];

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 5_000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
const MAX_TIMEZONE_LENGTH = 64;
const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export type AuthenticatedTaskContext = {
  userId: string;
};

export type CreateTaskInput = {
  title: string;
  description: string;
  priority: string;
  dueTime: string;
  timezone: string;
  tags: readonly string[];
};

export type CreateTaskResult = {
  task: {
    id: string;
    title: string;
    description: string;
    status: "pending" | "in_progress" | "completed" | "cancelled";
    priority: TaskPriority;
    due_time: string;
    timezone: string;
    tags: string[];
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  };
};

export type TaskDomainErrorCode =
  | "INVALID_AUTHENTICATED_USER"
  | "USER_NOT_FOUND"
  | "USER_DISABLED"
  | "INVALID_TITLE"
  | "INVALID_DESCRIPTION"
  | "INVALID_PRIORITY"
  | "INVALID_DUE_TIME"
  | "INVALID_TIMEZONE"
  | "INVALID_TAGS";

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
  constructor(private readonly repository: TaskRepository) {}

  async createTask(
    context: AuthenticatedTaskContext,
    input: CreateTaskInput,
  ): Promise<CreateTaskResult> {
    const userId = this.requireAuthenticatedUserId(context.userId);
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw new TaskDomainError("USER_NOT_FOUND", "User was not found.");
    }

    if (user.status !== "active") {
      throw new TaskDomainError("USER_DISABLED", "User is disabled.");
    }

    const normalized = this.normalizeInput(userId, input);
    const task = await this.repository.createTask(normalized);

    return this.toResult(task);
  }

  private requireAuthenticatedUserId(userId: string): string {
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
  ): NormalizedTaskCreate {
    return {
      userId,
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
      status: "pending",
      priority: this.normalizePriority(input.priority),
      dueTime: this.normalizeDueTime(input.dueTime),
      timezone: this.normalizeTimezone(input.timezone),
      tags: this.normalizeTags(input.tags),
      completedAt: null,
    };
  }

  private normalizeRequiredText(
    value: string,
    maxLength: number,
    code: "INVALID_TITLE" | "INVALID_DESCRIPTION",
    label: string,
  ): string {
    const normalized = value.normalize("NFC").trim();

    if (normalized.length === 0 || normalized.length > maxLength) {
      throw new TaskDomainError(
        code,
        `${label} must contain between 1 and ${maxLength} characters.`,
      );
    }

    return normalized;
  }

  private normalizePriority(priority: string): TaskPriority {
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

  private normalizeDueTime(dueTime: string): Date {
    const normalized = dueTime.trim();
    const match = ISO_INSTANT_PATTERN.exec(normalized);

    if (!match) {
      throw new TaskDomainError(
        "INVALID_DUE_TIME",
        "Task due time must be an ISO 8601 timestamp with Z or an explicit UTC offset.",
      );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
    const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > daysInMonth ||
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      offsetHour > 14 ||
      offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) {
      throw new TaskDomainError(
        "INVALID_DUE_TIME",
        "Task due time is not a valid timestamp.",
      );
    }

    const parsed = new Date(normalized);

    if (Number.isNaN(parsed.getTime())) {
      throw new TaskDomainError(
        "INVALID_DUE_TIME",
        "Task due time is not a valid timestamp.",
      );
    }

    return parsed;
  }

  private normalizeTimezone(timezone: string): string {
    const normalized = timezone.normalize("NFC").trim();

    if (normalized.length === 0 || normalized.length > MAX_TIMEZONE_LENGTH) {
      throw new TaskDomainError(
        "INVALID_TIMEZONE",
        "Task timezone is required and is too long.",
      );
    }

    try {
      new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
    } catch {
      throw new TaskDomainError(
        "INVALID_TIMEZONE",
        "Task timezone must be a valid IANA timezone.",
      );
    }

    return normalized;
  }

  private normalizeTags(tags: readonly string[]): string[] {
    if (!Array.isArray(tags)) {
      throw new TaskDomainError("INVALID_TAGS", "Task tags must be an array.");
    }

    const normalized = [
      ...new Set(
        tags.map((tag) => {
          const value = tag.normalize("NFC").trim();

          if (value.length === 0 || value.length > MAX_TAG_LENGTH) {
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

  private toResult(task: TaskRecord): CreateTaskResult {
    return {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        due_time: task.dueTime.toISOString(),
        timezone: task.timezone,
        tags: task.tags,
        created_at: task.createdAt.toISOString(),
        updated_at: task.updatedAt.toISOString(),
        completed_at: task.completedAt?.toISOString() ?? null,
      },
    };
  }
}
