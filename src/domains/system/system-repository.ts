import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  coreMemories,
  diaryEntries,
  mcpWriteIdempotency,
  resourceLifecycleEvents,
  tasks,
  toolCalls,
  users,
} from "../../database/schema.js";

export type SystemDataSummary = {
  memory: { active: number; archived: number };
  diary: { active: number; archived: number };
  task: { active: number; archived: number };
};

export type SystemLifecycleActivityRecord = {
  id: string;
  resourceType: string;
  action: string;
  actorType: string;
  channel: string;
  createdAt: Date;
};

export type SystemToolActivityRecord = {
  id: string;
  toolName: string;
  operation: string;
  source: string;
  status: string;
  errorCode: string | null;
  createdAt: Date;
};
export type SystemUserRecord = { status: "active" | "disabled" };

export interface SystemRepository {
  findUserById(userId: string): Promise<SystemUserRecord | null>;
  readDataSummary(userId: string): Promise<SystemDataSummary>;
  listLifecycleActivity(
    userId: string,
    limit: number,
  ): Promise<SystemLifecycleActivityRecord[]>;
  listToolActivity(
    userId: string,
    limit: number,
  ): Promise<SystemToolActivityRecord[]>;
}

type Database = ReturnType<typeof createDatabase>["db"];

const MCP_WRITE_TOOL_NAMES = [
  "create_task",
  "write_diary",
  "write_memory",
  "toy_set",
  "toy_stop",
] as const;

export class DrizzleSystemRepository implements SystemRepository {
  constructor(private readonly db: Database) {}

  async findUserById(userId: string): Promise<{ status: "active" | "disabled" } | null> {
    const [user] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ?? null;
  }

  async readDataSummary(userId: string): Promise<SystemDataSummary> {
    const [memoryRows, diaryRows, taskRows] = await Promise.all([
      this.db
        .select({ status: coreMemories.status, count: count() })
        .from(coreMemories)
        .where(eq(coreMemories.userId, userId))
        .groupBy(coreMemories.status),
      this.db
        .select({ status: diaryEntries.status, count: count() })
        .from(diaryEntries)
        .where(eq(diaryEntries.userId, userId))
        .groupBy(diaryEntries.status),
      this.db
        .select({ status: tasks.lifecycleStatus, count: count() })
        .from(tasks)
        .where(eq(tasks.userId, userId))
        .groupBy(tasks.lifecycleStatus),
    ]);

    return {
      memory: {
        active: readCount(memoryRows, "active"),
        archived: readCount(memoryRows, "archived"),
      },
      diary: {
        active: readCount(diaryRows, "active"),
        archived: readCount(diaryRows, "archived"),
      },
      task: {
        active: readCount(taskRows, "active"),
        archived: readCount(taskRows, "archived"),
      },
    };
  }

  async listLifecycleActivity(
    userId: string,
    limit: number,
  ): Promise<SystemLifecycleActivityRecord[]> {
    return this.db
      .select({
        id: resourceLifecycleEvents.id,
        resourceType: resourceLifecycleEvents.resourceType,
        action: resourceLifecycleEvents.action,
        actorType: resourceLifecycleEvents.actorType,
        channel: resourceLifecycleEvents.channel,
        createdAt: resourceLifecycleEvents.createdAt,
      })
      .from(resourceLifecycleEvents)
      .where(eq(resourceLifecycleEvents.userId, userId))
      .orderBy(desc(resourceLifecycleEvents.createdAt), desc(resourceLifecycleEvents.id))
      .limit(limit);
  }

  async listToolActivity(
    userId: string,
    limit: number,
  ): Promise<SystemToolActivityRecord[]> {
    const rows = await this.db
      .select({
        id: toolCalls.id,
        toolName: toolCalls.toolName,
        operation: toolCalls.operation,
        status: toolCalls.status,
        errorCode: toolCalls.errorCode,
        createdAt: toolCalls.createdAt,
      })
      .from(toolCalls)
      .innerJoin(
        mcpWriteIdempotency,
        and(
          eq(mcpWriteIdempotency.userId, toolCalls.userId),
          eq(mcpWriteIdempotency.toolName, toolCalls.toolName),
          eq(mcpWriteIdempotency.resourceType, toolCalls.resourceType),
          eq(mcpWriteIdempotency.idempotencyKey, toolCalls.idempotencyKey),
          eq(mcpWriteIdempotency.resourceId, toolCalls.resourceId),
        ),
      )
      .where(
        and(
          eq(toolCalls.userId, userId),
          inArray(toolCalls.toolName, [...MCP_WRITE_TOOL_NAMES]),
          isNotNull(toolCalls.idempotencyKey),
          isNotNull(toolCalls.resourceId),
        ),
      )
      .orderBy(desc(toolCalls.createdAt), desc(toolCalls.id))
      .limit(limit);

    return rows.map((row) => ({ ...row, source: "mcp" }));
  }
}

function readCount(
  rows: Array<{ status: string; count: number }>,
  status: string,
): number {
  const row = rows.find((candidate) => candidate.status === status);
  return Number(row?.count ?? 0);
}
