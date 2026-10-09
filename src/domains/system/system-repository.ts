import { and, count, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversations,
  diaryComments,
  diaryEntries,
  runtimeSubjectStates,
  todoPapers,
  universeNodes,
  users,
} from "../../database/schema.js";

export type SystemDataSummary = {
  diary: { active: number; archived: number };
  diary_comments: { count: number };
  todo: { active: number; count: number };
  conversations: { active: number; archived: number };
  mind: { count: number };
  universe: { nodes: number };
};

export type SystemUserRecord = { status: "active" | "disabled" };

export interface SystemRepository {
  findUserById(userId: string): Promise<SystemUserRecord | null>;
  readDataSummary(userId: string): Promise<SystemDataSummary>;
}

type Database = ReturnType<typeof createDatabase>["db"];

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
    const [
      diaryRows,
      diaryCommentRows,
      todoRows,
      conversationRows,
      mindRows,
      universeRows,
    ] = await Promise.all([
      this.db
        .select({ status: diaryEntries.status, count: count() })
        .from(diaryEntries)
        .where(eq(diaryEntries.userId, userId))
        .groupBy(diaryEntries.status),
      this.db
        .select({ count: count() })
        .from(diaryComments)
        .where(eq(diaryComments.userId, userId)),
      this.db
        .select({ count: count() })
        .from(todoPapers)
        .where(eq(todoPapers.userId, userId)),
      this.db
        .select({
          status: conversations.lifecycleStatus,
          count: count(),
        })
        .from(conversations)
        .where(and(
          eq(conversations.userId, userId),
          eq(conversations.origin, "native_live"),
          inArray(conversations.lifecycleStatus, ["active", "archived"]),
        ))
        .groupBy(conversations.lifecycleStatus),
      this.db
        .select({ count: count() })
        .from(runtimeSubjectStates)
        .where(eq(runtimeSubjectStates.userId, userId)),
      this.db
        .select({ count: count() })
        .from(universeNodes)
        .where(eq(universeNodes.userId, userId)),
    ]);

    return {
      diary: {
        active: readCount(diaryRows, "active"),
        archived: readCount(diaryRows, "archived"),
      },
      diary_comments: {
        count: Number(diaryCommentRows[0]?.count ?? 0),
      },
      todo: {
        active: Number(todoRows[0]?.count ?? 0),
        count: Number(todoRows[0]?.count ?? 0),
      },
      conversations: {
        active: readCount(conversationRows, "active"),
        archived: readCount(conversationRows, "archived"),
      },
      mind: {
        count: Number(mindRows[0]?.count ?? 0),
      },
      universe: {
        nodes: Number(universeRows[0]?.count ?? 0),
      },
    };
  }

}

function readCount(
  rows: Array<{ status: string; count: number }>,
  status: string,
): number {
  const row = rows.find((candidate) => candidate.status === status);
  return Number(row?.count ?? 0);
}
