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
  tasks,
  users,
  type taskPriorityEnum,
  type taskStatusEnum,
} from "../../database/schema.js";

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
  dueTime: Date;
  timezone: string;
  tags: string[];
  completedAt: null;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueTime: Date;
  timezone: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type TaskListQuery = {
  q?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  tag?: string;
  dueFrom?: Date;
  dueTo?: Date;
  overdueBefore?: Date;
};

export type UpdateTaskStatusInput = {
  userId: string;
  id: string;
  status: TaskStatus;
  completedAt: Date | null;
};

export type NormalizedTaskUpdate = {
  userId: string;
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueTime: Date;
  timezone: string;
  tags: string[];
};

export interface TaskRepository {
  findUserById(
    userId: string,
  ): Promise<TaskUserRecord | null>;

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

  updateTaskStatus(
    input: UpdateTaskStatusInput,
  ): Promise<TaskRecord | null>;

  updateTask(
    input: NormalizedTaskUpdate,
  ): Promise<TaskRecord | null>;
}

type Database = ReturnType<
  typeof createDatabase
>["db"];

export class DrizzleTaskRepository
  implements TaskRepository
{
  constructor(private readonly db: Database) {}

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

  async findTasks(
    userId: string,
    limit: number,
    query: TaskListQuery = {},
  ): Promise<TaskRecord[]> {
    const conditions = [eq(tasks.userId, userId)];

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
      conditions.push(sql`${tasks.status} in ('pending', 'in_progress')`);
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
      })
      .from(tasks)
      .where(and(...conditions))
      .orderBy(
        asc(tasks.dueTime),
        desc(tasks.createdAt),
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
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.id, id),
        ),
      )
      .limit(1);

    return task ?? null;
  }

  async createTask(
    input: NormalizedTaskCreate,
  ): Promise<TaskRecord> {
    const [task] = await this.db
      .insert(tasks)
      .values({
        userId: input.userId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        dueTime: input.dueTime,
        timezone: input.timezone,
        tags: input.tags,
        completedAt: input.completedAt,
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
      });

    if (!task) {
      throw new Error(
        "Task insert did not return a record.",
      );
    }

    return task;
  }

  async updateTaskStatus(
    input: UpdateTaskStatusInput,
  ): Promise<TaskRecord | null> {
    const [task] = await this.db
      .update(tasks)
      .set({
        status: input.status,
        completedAt: input.completedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.userId, input.userId),
          eq(tasks.id, input.id),
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
      });

    return task ?? null;
  }

  async updateTask(
    input: NormalizedTaskUpdate,
  ): Promise<TaskRecord | null> {
    const [task] = await this.db
      .update(tasks)
      .set({
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueTime: input.dueTime,
        timezone: input.timezone,
        tags: input.tags,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tasks.userId, input.userId),
          eq(tasks.id, input.id),
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
      });

    return task ?? null;
  }
}
