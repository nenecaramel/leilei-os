import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  resourceLifecycleEvents,
  tasks,
  userSettings,
  users,
  type taskPriorityEnum,
  type taskStatusEnum,
} from "../../database/schema.js";
import {
  createLifecycleAuditEvent,
  DrizzleLifecycleAuditPersistence,
  type LifecycleAuditPersistence,
  type LifecycleMutationInput,
} from "../lifecycle/lifecycle-audit-repository.js";
import {
  lockAndReadMcpIdempotency,
  recordMcpIdempotency,
} from "../mcp-write/mcp-write-idempotency.js";
import { requireActiveUserInTransaction } from "../require-active-user-transaction.js";
import type { ContentAuthor } from "../content-author.js";

export type TaskPriority =
  (typeof taskPriorityEnum.enumValues)[number];

export type TaskStatus =
  (typeof taskStatusEnum.enumValues)[number];

export type TaskUserRecord = {
  status: "active" | "disabled";
};

export type NormalizedTaskCreate = {
  userId: string;
  title: string;
  description: string;
  status: "pending";
  priority: TaskPriority;
  dueTime: Date | null;
  timezone: string;
  tags: string[];
  completedAt: null;
  author: ContentAuthor;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueTime: Date | null;
  timezone: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  resumeStatus?: TaskStatus | null;
  lifecycleStatus?: "active" | "archived";
  author?: ContentAuthor | null;
};

export type TaskLifecycleMutationInput = LifecycleMutationInput;

export type TaskIdempotentCreateResult =
  | { outcome: "created" | "replayed"; task: TaskRecord }
  | { outcome: "conflict" };

export type TaskListQuery = {
  q?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tag?: string;
  dueFrom?: Date;
  dueTo?: Date;
  overdueBefore?: Date;
  withoutDueTime?: boolean;
};

export type UpdateTaskStatusInput = {
  userId: string;
  id: string;
  status: TaskStatus;
  completedAt: Date | null;
  resumeStatus?: TaskStatus | null;
  expectedStatus?: TaskStatus;
};

export type ReopenTaskInput = {
  userId: string;
  id: string;
  expectedStatus: "completed" | "cancelled";
  resumeStatus: "pending" | "in_progress";
};

export type NormalizedTaskUpdate = {
  userId: string;
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueTime: Date | null;
  timezone: string;
  tags: string[];
  author?: ContentAuthor;
};

export interface TaskRepository {
  findUserById(
    userId: string,
  ): Promise<TaskUserRecord | null>;

  findUserTimezone(userId: string): Promise<string | null>;

  findTasks(
    userId: string,
    limit: number,
    query?: TaskListQuery,
  ): Promise<TaskRecord[]>;

  findTaskById(
    userId: string,
    id: string,
  ): Promise<TaskRecord | null>;

  createTask(
    input: NormalizedTaskCreate,
  ): Promise<TaskRecord>;

  createTaskIdempotently?(
    input: NormalizedTaskCreate & {
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<TaskIdempotentCreateResult>;

  updateTaskStatus(
    input: UpdateTaskStatusInput,
  ): Promise<TaskRecord | null>;

  reopenTask(
    input: ReopenTaskInput,
  ): Promise<TaskRecord | null>;

  updateTask(
    input: NormalizedTaskUpdate,
  ): Promise<TaskRecord | null>;

  findArchivedTasks?(userId: string, limit: number): Promise<TaskRecord[]>;
  findArchivedTaskById?(userId: string, id: string): Promise<TaskRecord | null>;
  archiveTask?(input: TaskLifecycleMutationInput): Promise<boolean>;
  restoreTask?(input: TaskLifecycleMutationInput): Promise<boolean>;
  permanentlyDeleteTask?(input: TaskLifecycleMutationInput): Promise<boolean>;
}

type Database = ReturnType<
  typeof createDatabase
>["db"];

export class DrizzleTaskRepository
  implements TaskRepository
{
  constructor(
    private readonly db: Database,
    private readonly lifecycleAudit: LifecycleAuditPersistence = new DrizzleLifecycleAuditPersistence(),
  ) {}

  async findUserById(
    userId: string,
  ): Promise<TaskUserRecord | null> {
    const [user] = await this.db
      .select({
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ?? null;
  }

  async findUserTimezone(userId: string): Promise<string | null> {
    const [settings] = await this.db
      .select({ timezone: userSettings.timezone })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1);

    return settings?.timezone ?? null;
  }

  async findTasks(
    userId: string,
    limit: number,
    query: TaskListQuery = {},
  ): Promise<TaskRecord[]> {
    const conditions = [eq(tasks.userId, userId), eq(tasks.lifecycleStatus, "active")];

    if (query.q) {
      const escaped = query.q.replace(/[\\%_]/g, "\\$&");
      const pattern = `%${escaped}%`;
      conditions.push(
        or(
          ilike(tasks.title, pattern),
          ilike(tasks.description, pattern),
        )!,
      );
    }
    if (query.status) conditions.push(eq(tasks.status, query.status));
    if (query.priority) conditions.push(eq(tasks.priority, query.priority));
    if (query.tag) {
      conditions.push(
        sql`${query.tag}::varchar(50) = any(${tasks.tags})`,
      );
    }
    if (query.dueFrom) conditions.push(gte(tasks.dueTime, query.dueFrom));
    if (query.dueTo) conditions.push(lt(tasks.dueTime, query.dueTo));
    if (query.overdueBefore) {
      conditions.push(lt(tasks.dueTime, query.overdueBefore));
    }
    if (query.withoutDueTime) {
      conditions.push(sql`${tasks.dueTime} is null`);
    }

    return this.db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        dueTime: tasks.dueTime,
        timezone: tasks.timezone,
        tags: tasks.tags,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
        resumeStatus: tasks.resumeStatus,
        author: tasks.author,
      })
      .from(tasks)
      .where(and(...conditions))
      .orderBy(
        asc(sql`${tasks.dueTime} is null`),
        asc(tasks.dueTime),
        desc(tasks.createdAt),
        asc(tasks.id),
      )
      .limit(limit);
  }

  async findTaskById(
    userId: string,
    id: string,
  ): Promise<TaskRecord | null> {
    const [task] = await this.db
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        dueTime: tasks.dueTime,
        timezone: tasks.timezone,
        tags: tasks.tags,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        completedAt: tasks.completedAt,
        resumeStatus: tasks.resumeStatus,
        author: tasks.author,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.id, id),
          eq(tasks.lifecycleStatus, "active"),
        ),
      )
      .limit(1);

    return task ?? null;
  }

  async createTask(
    input: NormalizedTaskCreate,
  ): Promise<TaskRecord> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const [task] = await transaction
        .insert(tasks)
        .values({
          userId: input.userId,
          title: input.title,
          description: input.description,
          status: input.status,
          resumeStatus: null,
          lifecycleStatus: "active",
          priority: input.priority,
          dueTime: input.dueTime,
          timezone: input.timezone,
          tags: input.tags,
          completedAt: input.completedAt,
          author: input.author,
        })
        .returning({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          dueTime: tasks.dueTime,
          timezone: tasks.timezone,
          tags: tasks.tags,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          completedAt: tasks.completedAt,
          resumeStatus: tasks.resumeStatus,
          author: tasks.author,
        });

      if (!task) {
        throw new Error(
          "Task insert did not return a record.",
        );
      }

      return task;
    });
  }

  async createTaskIdempotently(
    input: NormalizedTaskCreate & {
      idempotencyKey: string;
      requestHash: string;
    },
  ): Promise<TaskIdempotentCreateResult> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const idempotency = await lockAndReadMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "create_task",
        idempotencyKey: input.idempotencyKey,
      });

      if (idempotency) {
        if (
          idempotency.requestHash !== input.requestHash ||
          idempotency.resourceType !== "task"
        ) {
          return { outcome: "conflict" };
        }

        const [task] = await transaction
          .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            status: tasks.status,
            priority: tasks.priority,
            dueTime: tasks.dueTime,
            timezone: tasks.timezone,
            tags: tasks.tags,
            createdAt: tasks.createdAt,
            updatedAt: tasks.updatedAt,
            completedAt: tasks.completedAt,
            resumeStatus: tasks.resumeStatus,
            author: tasks.author,
          })
          .from(tasks)
          .where(and(eq(tasks.userId, input.userId), eq(tasks.id, idempotency.resourceId)))
          .limit(1);

        if (!task) throw new Error("Idempotent task record was not found.");
        return { outcome: "replayed", task };
      }

      const [task] = await transaction
        .insert(tasks)
        .values({
          userId: input.userId,
          title: input.title,
          description: input.description,
          status: input.status,
          resumeStatus: null,
          lifecycleStatus: "active",
          priority: input.priority,
          dueTime: input.dueTime,
          timezone: input.timezone,
          tags: input.tags,
          completedAt: input.completedAt,
          author: input.author,
        })
        .returning({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          dueTime: tasks.dueTime,
          timezone: tasks.timezone,
          tags: tasks.tags,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          completedAt: tasks.completedAt,
          resumeStatus: tasks.resumeStatus,
          author: tasks.author,
        });

      if (!task) throw new Error("Task insert did not return a record.");

      await recordMcpIdempotency(transaction, {
        userId: input.userId,
        toolName: "create_task",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "task",
        resourceId: task.id,
      });

      return { outcome: "created", task };
    });
  }

  async updateTaskStatus(
    input: UpdateTaskStatusInput,
  ): Promise<TaskRecord | null> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const [task] = await transaction
        .update(tasks)
        .set({
          status: input.status,
          resumeStatus: input.resumeStatus ?? null,
          completedAt: input.completedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.userId, input.userId),
            eq(tasks.id, input.id),
            eq(tasks.lifecycleStatus, "active"),
            ...(input.expectedStatus ? [eq(tasks.status, input.expectedStatus)] : []),
          ),
        )
        .returning({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          dueTime: tasks.dueTime,
          timezone: tasks.timezone,
          tags: tasks.tags,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          completedAt: tasks.completedAt,
          resumeStatus: tasks.resumeStatus,
          author: tasks.author,
        });

      return task ?? null;
    });
  }

  async reopenTask(
    input: ReopenTaskInput,
  ): Promise<TaskRecord | null> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const [task] = await transaction
        .update(tasks)
        .set({
          status: input.resumeStatus,
          resumeStatus: null,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tasks.userId, input.userId),
            eq(tasks.id, input.id),
            eq(tasks.lifecycleStatus, "active"),
            eq(tasks.status, input.expectedStatus),
            eq(tasks.resumeStatus, input.resumeStatus),
          ),
        )
        .returning({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          dueTime: tasks.dueTime,
          timezone: tasks.timezone,
          tags: tasks.tags,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          completedAt: tasks.completedAt,
          resumeStatus: tasks.resumeStatus,
          author: tasks.author,
        });

      return task ?? null;
    });
  }

  async updateTask(
    input: NormalizedTaskUpdate,
  ): Promise<TaskRecord | null> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const [task] = await transaction
        .update(tasks)
        .set({
          title: input.title,
          description: input.description,
          priority: input.priority,
          dueTime: input.dueTime,
          timezone: input.timezone,
          tags: input.tags,
          updatedAt: new Date(),
          ...(input.author === undefined ? {} : { author: input.author }),
        })
        .where(
          and(
            eq(tasks.userId, input.userId),
            eq(tasks.id, input.id),
            eq(tasks.lifecycleStatus, "active"),
          ),
        )
        .returning({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
          priority: tasks.priority,
          dueTime: tasks.dueTime,
          timezone: tasks.timezone,
          tags: tasks.tags,
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          completedAt: tasks.completedAt,
          resumeStatus: tasks.resumeStatus,
          author: tasks.author,
        });

      return task ?? null;
    });
  }

  async findArchivedTasks(userId: string, limit: number): Promise<TaskRecord[]> {
    return this.db.select({
      id: tasks.id, title: tasks.title, description: tasks.description,
      status: tasks.status, priority: tasks.priority, dueTime: tasks.dueTime,
      timezone: tasks.timezone, tags: tasks.tags, createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt, completedAt: tasks.completedAt,
      resumeStatus: tasks.resumeStatus,
      author: tasks.author,
      lifecycleStatus: tasks.lifecycleStatus,
    }).from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.lifecycleStatus, "archived")))
      .orderBy(asc(sql`${tasks.dueTime} is null`), asc(tasks.dueTime), desc(tasks.createdAt), asc(tasks.id))
      .limit(limit);
  }

  async findArchivedTaskById(userId: string, id: string): Promise<TaskRecord | null> {
    const [task] = await this.db.select({
      id: tasks.id, title: tasks.title, description: tasks.description,
      status: tasks.status, priority: tasks.priority, dueTime: tasks.dueTime,
      timezone: tasks.timezone, tags: tasks.tags, createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt, completedAt: tasks.completedAt,
      resumeStatus: tasks.resumeStatus,
      author: tasks.author,
      lifecycleStatus: tasks.lifecycleStatus,
    }).from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.id, id), eq(tasks.lifecycleStatus, "archived")))
      .limit(1);
    return task ?? null;
  }

  async archiveTask(input: TaskLifecycleMutationInput): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const rows = await transaction.update(tasks).set({ lifecycleStatus: "archived" })
        .where(and(eq(tasks.id, input.id), eq(tasks.userId, input.userId), eq(tasks.lifecycleStatus, "active")))
        .returning({ id: tasks.id });
      if (rows.length !== 1) return false;
      await this.lifecycleAudit.record(transaction, createLifecycleAuditEvent({
        userId: input.userId, resourceType: "task", resourceId: input.id,
        action: "archive", actorType: input.actorType, channel: input.channel,
      }));
      return true;
    });
  }

  async restoreTask(input: TaskLifecycleMutationInput): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);
      const rows = await transaction.update(tasks).set({ lifecycleStatus: "active" })
        .where(and(eq(tasks.id, input.id), eq(tasks.userId, input.userId), eq(tasks.lifecycleStatus, "archived")))
        .returning({ id: tasks.id });
      if (rows.length !== 1) return false;
      await this.lifecycleAudit.record(transaction, createLifecycleAuditEvent({
        userId: input.userId, resourceType: "task", resourceId: input.id,
        action: "restore", actorType: input.actorType, channel: input.channel,
      }));
      return true;
    });
  }

  async permanentlyDeleteTask(input: TaskLifecycleMutationInput): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      await requireActiveUserInTransaction(transaction, input.userId);

      const eligible = await transaction
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(
          eq(tasks.id, input.id),
          eq(tasks.userId, input.userId),
          eq(tasks.lifecycleStatus, "archived"),
        ))
        .limit(1);
      if (eligible.length !== 1) return false;

      await transaction.delete(resourceLifecycleEvents).where(and(
        eq(resourceLifecycleEvents.userId, input.userId),
        eq(resourceLifecycleEvents.resourceType, "task"),
        eq(resourceLifecycleEvents.resourceId, input.id),
      ));

      const deleted = await transaction.delete(tasks).where(and(
        eq(tasks.id, input.id),
        eq(tasks.userId, input.userId),
        eq(tasks.lifecycleStatus, "archived"),
      )).returning({ id: tasks.id });
      if (deleted.length !== 1) return false;

      const remaining = await transaction.select({ id: tasks.id }).from(tasks).where(and(
        eq(tasks.id, input.id),
        eq(tasks.userId, input.userId),
      )).limit(1);
      if (remaining.length !== 0) {
        throw new Error("Task permanent delete did not remove the task.");
      }

      await this.lifecycleAudit.record(transaction, createLifecycleAuditEvent({
        userId: input.userId,
        resourceType: "task",
        resourceId: input.id,
        action: "permanent_delete",
        actorType: input.actorType,
        channel: input.channel,
      }));
      return true;
    });
  }
}
