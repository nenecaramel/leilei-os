import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationMessages,
  conversations,
  users,
} from "../../database/schema.js";
import type { ConversationProvider } from "./conversation-types.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type ConversationArchiveListItem = {
  id: string;
  provider: ConversationProvider;
  sourceConversationId: string;
  title: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  defaultModel: string | null;
  currentLeafSourceNodeId: string | null;
  messageCount: number;
  turnCount: number;
  totalNodeCount: number;
};

export type ConversationArchiveDetail = ConversationArchiveListItem & {
  providerMetadata: Record<string, unknown>;
};

export type ConversationArchiveMessage = {
  id: string;
  sourceNodeId: string;
  sourceMessageId: string | null;
  parentSourceNodeId: string | null;
  role: "user" | "assistant" | "system" | "tool" | "reasoning" | "unknown";
  rawRole: string | null;
  model: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  isCurrentPath: boolean;
  currentPathIndex: number | null;
  turnIndex: number | null;
  isPrimary: boolean;
  displayText: string;
};

export type ConversationArchiveSearchRecord = {
  messageId: string;
  conversationId: string;
  provider: ConversationProvider;
  conversationTitle: string | null;
  sourceNodeId: string;
  role: "user" | "assistant";
  model: string | null;
  sourceCreatedAt: string | null;
  isCurrentPath: boolean;
  displayText: string;
};

export type ConversationDailyStat = {
  date: string;
  provider: ConversationProvider;
  conversations: number;
  messages: number;
  userMessages: number;
  assistantMessages: number;
  turns: number;
  pathBasis: "current_path" | "branch_inclusive";
};

export interface ConversationArchiveReadRepository {
  findUserStatus(userId: string): Promise<"active" | "disabled" | null>;
  listConversations(input: {
    userId: string;
    provider?: ConversationProvider;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationArchiveListItem[]; total: number }>;
  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<ConversationArchiveDetail | null>;
  listMessages(input: {
    userId: string;
    conversationId: string;
    provider: ConversationProvider;
    view: "default" | "all";
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationArchiveMessage[]; total: number }>;
  searchMessages(input: {
    userId: string;
    query: string;
    provider?: ConversationProvider;
    role?: "user" | "assistant";
    conversationId?: string;
    from?: string;
    to?: string;
    timeZone?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationArchiveSearchRecord[]; total: number }>;
  findMessageOrdinal(input: {
    userId: string;
    conversationId: string;
    provider: ConversationProvider;
    view: "default" | "all";
    messageId: string;
  }): Promise<{ index: number; total: number } | null>;
  dailyStats(input: {
    userId: string;
    from: string;
    to: string;
    timeZone: string;
  }): Promise<ConversationDailyStat[]>;
}

function messageVisibility(
  provider: ConversationProvider,
  view: "default" | "all",
) {
  if (view === "all" || provider === "claude") {
    return and(
      eq(conversationMessages.isPrimary, true),
      inArray(conversationMessages.role, ["user", "assistant"]),
    );
  }
  return and(
    eq(conversationMessages.isPrimary, true),
    inArray(conversationMessages.role, ["user", "assistant"]),
    eq(conversationMessages.isCurrentPath, true),
  );
}

function messageOrder(
  provider: ConversationProvider,
  view: "default" | "all",
) {
  return provider === "chatgpt" && view === "default"
    ? [asc(conversationMessages.currentPathIndex), asc(conversationMessages.id)] as const
    : [asc(conversationMessages.sourceCreatedAt), asc(conversationMessages.id)] as const;
}

function visibleMessagePredicate() {
  return and(
    eq(conversationMessages.isPrimary, true),
    inArray(conversationMessages.role, ["user", "assistant"]),
    or(
      and(
        eq(conversations.provider, "chatgpt"),
        eq(conversationMessages.isCurrentPath, true),
      ),
      eq(conversations.provider, "claude"),
    ),
  );
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export class DrizzleConversationArchiveReadRepository
implements ConversationArchiveReadRepository {
  constructor(private readonly db: Database) {}

  async findUserStatus(userId: string): Promise<"active" | "disabled" | null> {
    const [row] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.status ?? null;
  }

  async listConversations(input: {
    userId: string;
    provider?: ConversationProvider;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationArchiveListItem[]; total: number }> {
    const where = input.provider
      ? and(
          eq(conversations.userId, input.userId),
          eq(conversations.provider, input.provider),
        )
      : eq(conversations.userId, input.userId);

    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(conversations)
      .where(where);

    const rows = await this.db
      .select({
        id: conversations.id,
        provider: conversations.provider,
        sourceConversationId: conversations.sourceConversationId,
        title: conversations.title,
        sourceCreatedAt: conversations.sourceCreatedAt,
        sourceUpdatedAt: conversations.sourceUpdatedAt,
        defaultModel: conversations.defaultModel,
        currentLeafSourceNodeId: conversations.currentLeafSourceNodeId,
        messageCount: sql<number>`
          count(*) filter (
            where ${conversationMessages.isPrimary} = true
              and ${conversationMessages.role} in ('user', 'assistant')
              and (
                (${conversations.provider} = 'chatgpt' and ${conversationMessages.isCurrentPath} = true)
                or ${conversations.provider} = 'claude'
              )
          )::int
        `,
        turnCount: sql<number>`
          count(*) filter (
            where ${conversationMessages.isPrimary} = true
              and ${conversationMessages.role} = 'user'
              and (
                (${conversations.provider} = 'chatgpt' and ${conversationMessages.isCurrentPath} = true)
                or ${conversations.provider} = 'claude'
              )
          )::int
        `,
        totalNodeCount: sql<number>`count(${conversationMessages.id})::int`,
      })
      .from(conversations)
      .leftJoin(
        conversationMessages,
        and(
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.conversationId, conversations.id),
        ),
      )
      .where(where)
      .groupBy(conversations.id)
      .orderBy(
        desc(sql`coalesce(${conversations.sourceUpdatedAt}, ${conversations.sourceCreatedAt}, ${conversations.updatedAt})`),
        desc(conversations.id),
      )
      .limit(input.limit)
      .offset(input.offset);

    return {
      total: countRow?.total ?? 0,
      items: rows.map((row) => ({
        ...row,
        provider: row.provider as ConversationProvider,
        sourceCreatedAt: toIso(row.sourceCreatedAt),
        sourceUpdatedAt: toIso(row.sourceUpdatedAt),
        messageCount: row.messageCount ?? 0,
        turnCount: row.turnCount ?? 0,
        totalNodeCount: row.totalNodeCount ?? 0,
      })),
    };
  }

  async getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<ConversationArchiveDetail | null> {
    const [row] = await this.db
      .select({
        id: conversations.id,
        provider: conversations.provider,
        sourceConversationId: conversations.sourceConversationId,
        title: conversations.title,
        sourceCreatedAt: conversations.sourceCreatedAt,
        sourceUpdatedAt: conversations.sourceUpdatedAt,
        defaultModel: conversations.defaultModel,
        currentLeafSourceNodeId: conversations.currentLeafSourceNodeId,
        providerMetadata: conversations.providerMetadata,
        messageCount: sql<number>`
          count(*) filter (
            where ${conversationMessages.isPrimary} = true
              and ${conversationMessages.role} in ('user', 'assistant')
              and (
                (${conversations.provider} = 'chatgpt' and ${conversationMessages.isCurrentPath} = true)
                or ${conversations.provider} = 'claude'
              )
          )::int
        `,
        turnCount: sql<number>`
          count(*) filter (
            where ${conversationMessages.isPrimary} = true
              and ${conversationMessages.role} = 'user'
              and (
                (${conversations.provider} = 'chatgpt' and ${conversationMessages.isCurrentPath} = true)
                or ${conversations.provider} = 'claude'
              )
          )::int
        `,
        totalNodeCount: sql<number>`count(${conversationMessages.id})::int`,
      })
      .from(conversations)
      .leftJoin(
        conversationMessages,
        and(
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.conversationId, conversations.id),
        ),
      )
      .where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, input.conversationId),
      ))
      .groupBy(conversations.id)
      .limit(1);

    return row ? {
      ...row,
      provider: row.provider as ConversationProvider,
      sourceCreatedAt: toIso(row.sourceCreatedAt),
      sourceUpdatedAt: toIso(row.sourceUpdatedAt),
      messageCount: row.messageCount ?? 0,
      turnCount: row.turnCount ?? 0,
      totalNodeCount: row.totalNodeCount ?? 0,
    } : null;
  }

  async listMessages(input: {
    userId: string;
    conversationId: string;
    provider: ConversationProvider;
    view: "default" | "all";
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationArchiveMessage[]; total: number }> {
    const visibility = messageVisibility(input.provider, input.view);
    const where = and(
      eq(conversationMessages.userId, input.userId),
      eq(conversationMessages.conversationId, input.conversationId),
      visibility,
    );

    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(conversationMessages)
      .where(where);

    const rows = await this.db
      .select({
        id: conversationMessages.id,
        sourceNodeId: conversationMessages.sourceNodeId,
        sourceMessageId: conversationMessages.sourceMessageId,
        parentSourceNodeId: conversationMessages.parentSourceNodeId,
        role: conversationMessages.role,
        rawRole: conversationMessages.rawRole,
        model: conversationMessages.model,
        sourceCreatedAt: conversationMessages.sourceCreatedAt,
        sourceUpdatedAt: conversationMessages.sourceUpdatedAt,
        isCurrentPath: conversationMessages.isCurrentPath,
        currentPathIndex: conversationMessages.currentPathIndex,
        turnIndex: conversationMessages.turnIndex,
        isPrimary: conversationMessages.isPrimary,
        displayText: conversationMessages.displayText,
      })
      .from(conversationMessages)
      .where(where)
      .orderBy(...messageOrder(input.provider, input.view))
      .limit(input.limit)
      .offset(input.offset);

    return {
      total: countRow?.total ?? 0,
      items: rows.map((row) => ({
        ...row,
        role: row.role as ConversationArchiveMessage["role"],
        sourceCreatedAt: toIso(row.sourceCreatedAt),
        sourceUpdatedAt: toIso(row.sourceUpdatedAt),
      })),
    };
  }

  async searchMessages(input: {
    userId: string;
    query: string;
    provider?: ConversationProvider;
    role?: "user" | "assistant";
    conversationId?: string;
    from?: string;
    to?: string;
    timeZone?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationArchiveSearchRecord[]; total: number }> {
    const localDate = input.timeZone
      ? sql<string>`timezone(${input.timeZone}, ${conversationMessages.sourceCreatedAt})::date`
      : null;
    const where = and(
      eq(conversationMessages.userId, input.userId),
      eq(conversationMessages.isPrimary, true),
      inArray(conversationMessages.role, ["user", "assistant"]),
      sql`strpos(lower(${conversationMessages.displayText}), lower(${input.query})) > 0`,
      input.provider ? eq(conversations.provider, input.provider) : undefined,
      input.role ? eq(conversationMessages.role, input.role) : undefined,
      input.conversationId
        ? eq(conversations.id, input.conversationId)
        : undefined,
      input.from && localDate ? gte(localDate, input.from) : undefined,
      input.to && localDate ? lte(localDate, input.to) : undefined,
    );

    const baseJoin = and(
      eq(conversations.userId, input.userId),
      eq(conversations.id, conversationMessages.conversationId),
    );
    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(conversationMessages)
      .innerJoin(conversations, baseJoin)
      .where(where);

    const rows = await this.db
      .select({
        messageId: conversationMessages.id,
        conversationId: conversations.id,
        provider: conversations.provider,
        conversationTitle: conversations.title,
        sourceNodeId: conversationMessages.sourceNodeId,
        role: conversationMessages.role,
        model: conversationMessages.model,
        sourceCreatedAt: conversationMessages.sourceCreatedAt,
        isCurrentPath: conversationMessages.isCurrentPath,
        displayText: conversationMessages.displayText,
      })
      .from(conversationMessages)
      .innerJoin(conversations, baseJoin)
      .where(where)
      .orderBy(
        desc(conversationMessages.sourceCreatedAt),
        desc(conversationMessages.id),
      )
      .limit(input.limit)
      .offset(input.offset);

    return {
      total: countRow?.total ?? 0,
      items: rows.map((row) => ({
        ...row,
        provider: row.provider as ConversationProvider,
        role: row.role as "user" | "assistant",
        sourceCreatedAt: toIso(row.sourceCreatedAt),
      })),
    };
  }

  async findMessageOrdinal(input: {
    userId: string;
    conversationId: string;
    provider: ConversationProvider;
    view: "default" | "all";
    messageId: string;
  }): Promise<{ index: number; total: number } | null> {
    const rows = await this.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.userId, input.userId),
        eq(conversationMessages.conversationId, input.conversationId),
        messageVisibility(input.provider, input.view),
      ))
      .orderBy(...messageOrder(input.provider, input.view));

    const index = rows.findIndex((row) => row.id === input.messageId);
    return index < 0 ? null : { index, total: rows.length };
  }

  async dailyStats(input: {
    userId: string;
    from: string;
    to: string;
    timeZone: string;
  }): Promise<ConversationDailyStat[]> {
    const localDate = sql<string>`timezone(${input.timeZone}, ${conversationMessages.sourceCreatedAt})::date`;
    const rows = await this.db
      .select({
        date: localDate,
        provider: conversations.provider,
        conversations: sql<number>`count(distinct ${conversations.id})::int`,
        messages: sql<number>`count(*)::int`,
        userMessages: sql<number>`count(*) filter (where ${conversationMessages.role} = 'user')::int`,
        assistantMessages: sql<number>`count(*) filter (where ${conversationMessages.role} = 'assistant')::int`,
        turns: sql<number>`count(*) filter (where ${conversationMessages.role} = 'user')::int`,
      })
      .from(conversationMessages)
      .innerJoin(
        conversations,
        and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, conversationMessages.conversationId),
        ),
      )
      .where(and(
        eq(conversationMessages.userId, input.userId),
        sql`${conversationMessages.sourceCreatedAt} is not null`,
        visibleMessagePredicate(),
        gte(localDate, input.from),
        lte(localDate, input.to),
      ))
      .groupBy(localDate, conversations.provider)
      .orderBy(asc(localDate), asc(conversations.provider));

    return rows.map((row) => ({
      date: row.date,
      provider: row.provider as ConversationProvider,
      conversations: row.conversations,
      messages: row.messages,
      userMessages: row.userMessages,
      assistantMessages: row.assistantMessages,
      turns: row.turns,
      pathBasis: row.provider === "chatgpt" ? "current_path" : "branch_inclusive",
    }));
  }
}
