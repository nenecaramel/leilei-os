import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  diaryEntries,
  resourceLifecycleEvents,
  todoPapers,
  toolCalls,
  users,
} from "../../database/schema.js";

export type SystemDataSummary = {
  diary: { active: number; archived: number };
  todo: { active: number };
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
  "write_diary",
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
    const [diaryRows, todoRows] = await Promise.all([
      this.db
        .select({ status: diaryEntries.status, count: count() })
        .from(diaryEntries)
        .where(eq(diaryEntries.userId, userId))
        .groupBy(diaryEntries.status),
      this.db
        .select({ count: count() })
        .from(todoPapers)
        .where(eq(todoPapers.userId, userId)),
    ]);

    return {
      diary: {
        active: readCount(diaryRows, "active"),
        archived: readCount(diaryRows, "archived"),
      },
      todo: {
        active: Number(todoRows[0]?.count ?? 0),
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
