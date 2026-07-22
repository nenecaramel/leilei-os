import { eq } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  tasks,
  users,
  type taskPriorityEnum,
  type taskStatusEnum,
} from "../../database/schema.js";

export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];

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

export interface TaskRepository {
  findUserById(userId: string): Promise<TaskUserRecord | null>;
  createTask(input: NormalizedTaskCreate): Promise<TaskRecord>;
}

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleTaskRepository implements TaskRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<TaskUserRecord | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user ?? null;
  }

  async createTask(input: NormalizedTaskCreate): Promise<TaskRecord> {
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
      throw new Error("Task insert did not return a record.");
    }

    return task;
  }
}
