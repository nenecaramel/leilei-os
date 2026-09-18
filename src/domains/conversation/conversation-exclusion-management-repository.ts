import { and, desc, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationExclusions,
  conversationMessages,
  conversations,
  users,
  type ConversationExclusionScope,
  type ConversationProvider,
} from "../../database/schema.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type ConversationExclusionListItem = {
  id: string;
  provider: ConversationProvider;
  scope: ConversationExclusionScope;
  sourceConversationId: string;
  sourceNodeId: string | null;
  canonicalConversationExists: boolean;
  canonicalNodeExists: boolean | null;
  createdAt: string;
};

export interface ConversationExclusionManagementRepository {
  findUserStatus(userId: string): Promise<"active" | "disabled" | null>;
  listExclusions(input: {
    userId: string;
    provider?: ConversationProvider;
    scope?: ConversationExclusionScope;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationExclusionListItem[]; total: number }>;
  getExclusion(input: { userId: string; exclusionId: string }): Promise<ConversationExclusionListItem | null>;
  deleteExclusion(input: {
    userId: string;
    exclusionId: string;
  }): Promise<ConversationExclusionListItem | null>;
}

function toIso(value: Date): string {
  return value.toISOString();
}

export class DrizzleConversationExclusionManagementRepository
implements ConversationExclusionManagementRepository {
  constructor(private readonly db: Database) {}

  async findUserStatus(userId: string): Promise<"active" | "disabled" | null> {
    const [row] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.status ?? null;
  }

  async listExclusions(input: {
    userId: string;
    provider?: ConversationProvider;
    scope?: ConversationExclusionScope;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationExclusionListItem[]; total: number }> {
    const where = and(
      eq(conversationExclusions.userId, input.userId),
      input.provider
        ? eq(conversationExclusions.provider, input.provider)
        : undefined,
      input.scope
        ? eq(conversationExclusions.scope, input.scope)
        : undefined,
    );
    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(conversationExclusions)
      .where(where);

    const rows = await this.db
      .select({
        id: conversationExclusions.id,
        provider: conversationExclusions.provider,
        scope: conversationExclusions.scope,
        sourceConversationId: conversationExclusions.sourceConversationId,
        sourceNodeId: conversationExclusions.sourceNodeId,
        canonicalConversationExists: sql<boolean>`${conversations.id} is not null`,
        canonicalNodeExists: sql<boolean | null>`
          case
            when ${conversationExclusions.scope} = 'branch'
              then ${conversationMessages.id} is not null
            else null
          end
        `,
        createdAt: conversationExclusions.createdAt,
      })
      .from(conversationExclusions)
      .leftJoin(
        conversations,
        and(
          eq(conversations.userId, input.userId),
          eq(conversations.provider, conversationExclusions.provider),
          eq(conversations.sourceConversationId, conversationExclusions.sourceConversationId),
        ),
      )
      .leftJoin(
        conversationMessages,
        and(
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.conversationId, conversations.id),
          eq(conversationMessages.sourceNodeId, conversationExclusions.sourceNodeId),
        ),
      )
      .where(where)
      .orderBy(desc(conversationExclusions.createdAt), desc(conversationExclusions.id))
      .limit(input.limit)
      .offset(input.offset);

    return {
      total: countRow?.total ?? 0,
      items: rows.map((row) => ({
        ...row,
        provider: row.provider as ConversationProvider,
        scope: row.scope as ConversationExclusionScope,
        createdAt: toIso(row.createdAt),
      })),
    };
  }

  async getExclusion(input: { userId: string; exclusionId: string }): Promise<ConversationExclusionListItem | null> {
    const [row] = await this.db
      .select({
        id: conversationExclusions.id,
        provider: conversationExclusions.provider,
        scope: conversationExclusions.scope,
        sourceConversationId: conversationExclusions.sourceConversationId,
        sourceNodeId: conversationExclusions.sourceNodeId,
        canonicalConversationExists: sql<boolean>`${conversations.id} is not null`,
        canonicalNodeExists: sql<boolean | null>`case when ${conversationExclusions.scope} = 'branch' then ${conversationMessages.id} is not null else null end`,
        createdAt: conversationExclusions.createdAt,
      })
      .from(conversationExclusions)
      .leftJoin(conversations, and(
        eq(conversations.userId, input.userId),
        eq(conversations.provider, conversationExclusions.provider),
        eq(conversations.sourceConversationId, conversationExclusions.sourceConversationId),
      ))
      .leftJoin(conversationMessages, and(
        eq(conversationMessages.userId, input.userId),
        eq(conversationMessages.conversationId, conversations.id),
        eq(conversationMessages.sourceNodeId, conversationExclusions.sourceNodeId),
      ))
      .where(and(eq(conversationExclusions.userId, input.userId), eq(conversationExclusions.id, input.exclusionId)))
      .limit(1);
    return row ? {
      ...row,
      provider: row.provider as ConversationProvider,
      scope: row.scope as ConversationExclusionScope,
      createdAt: toIso(row.createdAt),
    } : null;
  }

  async deleteExclusion(input: {
    userId: string;
    exclusionId: string;
  }): Promise<ConversationExclusionListItem | null> {
    return this.db.transaction(async (transaction) => {
      const [rule] = await transaction
        .select({
          id: conversationExclusions.id,
          provider: conversationExclusions.provider,
          scope: conversationExclusions.scope,
          sourceConversationId: conversationExclusions.sourceConversationId,
          sourceNodeId: conversationExclusions.sourceNodeId,
          createdAt: conversationExclusions.createdAt,
        })
        .from(conversationExclusions)
        .where(and(
          eq(conversationExclusions.userId, input.userId),
          eq(conversationExclusions.id, input.exclusionId),
        ))
        .for("update")
        .limit(1);
      if (!rule) return null;

      const [conversation] = await transaction
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.provider, rule.provider),
          eq(conversations.sourceConversationId, rule.sourceConversationId),
        ))
        .limit(1);

      let canonicalNodeExists: boolean | null = null;
      if (rule.scope === "branch") {
        if (!conversation || !rule.sourceNodeId) {
          canonicalNodeExists = false;
        } else {
          const [message] = await transaction
            .select({ id: conversationMessages.id })
            .from(conversationMessages)
            .where(and(
              eq(conversationMessages.userId, input.userId),
              eq(conversationMessages.conversationId, conversation.id),
              eq(conversationMessages.sourceNodeId, rule.sourceNodeId),
            ))
            .limit(1);
          canonicalNodeExists = Boolean(message);
        }
      }

      await transaction
        .delete(conversationExclusions)
        .where(and(
          eq(conversationExclusions.userId, input.userId),
          eq(conversationExclusions.id, input.exclusionId),
        ));

      return {
        id: rule.id,
        provider: rule.provider,
        scope: rule.scope,
        sourceConversationId: rule.sourceConversationId,
        sourceNodeId: rule.sourceNodeId,
        canonicalConversationExists: Boolean(conversation),
        canonicalNodeExists,
        createdAt: toIso(rule.createdAt),
      };
    }, { isolationLevel: "serializable" });
  }
}
