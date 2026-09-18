import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationDeletedBranches,
  conversationAttachments,
  conversationContentBlocks,
  conversationFavoriteMessages,
  conversationMessages,
  conversations,
  users,
} from "../../database/schema.js";
import type { ConversationContentKind, ConversationProvider } from "./conversation-types.js";

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
  archivedAt: string | null;
  deletedAt: string | null;
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

export type ConversationArchiveContentBlock = {
  ordinal: number;
  kind: ConversationContentKind;
  rawType: string;
  text: string | null;
  payload: Record<string, unknown> | null;
};

export type ConversationArchiveAttachment = {
  ordinal: number;
  sourceAttachmentId: string | null;
  name: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  payload: Record<string, unknown>;
};

export type ConversationArchiveMessagePayload = {
  contentBlocks: ConversationArchiveContentBlock[];
  attachments: ConversationArchiveAttachment[];
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
    scope?: "active" | "archived" | "deleted";
  }): Promise<{ items: ConversationArchiveListItem[]; total: number }>;
  getConversation(input: {
    userId: string;
    conversationId: string;
    scope?: "active" | "archived" | "deleted";
    branchId?: string;
  }): Promise<ConversationArchiveDetail | null>;
  listMessages(input: {
    userId: string;
    conversationId: string;
    provider: ConversationProvider;
    view: "default" | "all";
    limit: number;
    offset: number;
    scope?: "active" | "archived" | "deleted";
    branchId?: string;
  }): Promise<{ items: ConversationArchiveMessage[]; total: number }>;
  readMessagePayloads(input: {
    userId: string;
    messageIds: string[];
  }): Promise<Record<string, ConversationArchiveMessagePayload>>;
  searchMessages(input: {
    userId: string;
    query: string;
    provider?: ConversationProvider;
    role?: "user" | "assistant";
    conversationId?: string;
    from?: string;
    to?: string;
    timeZone?: string;
    favoritesOnly?: boolean;
    limit: number;
    offset: number;
    scope?: "active" | "archived" | "deleted";
  }): Promise<{ items: ConversationArchiveSearchRecord[]; total: number }>;
  findMessageOrdinal(input: {
    userId: string;
    conversationId: string;
    provider: ConversationProvider;
    view: "default" | "all";
    messageId: string;
    branchId?: string;
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

function lifecyclePredicate(
  scope: "active" | "archived" | "deleted" | undefined,
  userId?: string,
  conversationId?: unknown,
  branchId?: string,
) {
  if (scope === "deleted" && userId && conversationId && branchId) {
    return sql`${conversations.deletedAt} IS NULL AND exists (
      select 1 from ${conversationDeletedBranches} deleted_branch
      where deleted_branch.id = ${branchId}
        and deleted_branch.user_id = ${userId}
        and deleted_branch.conversation_id = ${conversationId}
    )`;
  }
  if (scope === "archived") return sql`${conversations.archivedAt} IS NOT NULL AND ${conversations.deletedAt} IS NULL`;
  if (scope === "deleted") return sql`${conversations.deletedAt} IS NOT NULL`;
  return sql`${conversations.archivedAt} IS NULL AND ${conversations.deletedAt} IS NULL`;
}

function branchVisibilityPredicate(userId: string) {
  return sql`not exists (
    select 1 from ${conversationDeletedBranches} deleted_branch
    where deleted_branch.user_id = ${userId}
      and deleted_branch.conversation_id = ${conversationMessages.conversationId}
      and exists (
        with recursive branch_nodes(source_node_id) as (
          select deleted_branch.source_node_id
          union all
          select descendant.source_node_id
          from conversation_messages descendant
          join branch_nodes parent on descendant.parent_source_node_id = parent.source_node_id
          where descendant.conversation_id = deleted_branch.conversation_id
        )
        select 1 from branch_nodes
        where branch_nodes.source_node_id = ${conversationMessages.sourceNodeId}
      )
  )`;
}

function branchSelectionPredicate(userId: string, branchId: string) {
  return sql`exists (
    with recursive branch_nodes(source_node_id) as (
      select deleted_branch.source_node_id
      from ${conversationDeletedBranches} deleted_branch
      where deleted_branch.id = ${branchId}
        and deleted_branch.user_id = ${userId}
        and deleted_branch.conversation_id = ${conversationMessages.conversationId}
      union all
      select descendant.source_node_id
      from conversation_messages descendant
      join branch_nodes parent on descendant.parent_source_node_id = parent.source_node_id
      where descendant.conversation_id = ${conversationMessages.conversationId}
    )
    select 1 from branch_nodes
    where branch_nodes.source_node_id = ${conversationMessages.sourceNodeId}
  )`;
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
    scope?: "active" | "archived" | "deleted";
  }): Promise<{ items: ConversationArchiveListItem[]; total: number }> {
    const where = and(
      eq(conversations.userId, input.userId),
      input.provider ? eq(conversations.provider, input.provider) : undefined,
      lifecyclePredicate(input.scope),
    );

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
              and ${branchVisibilityPredicate(input.userId)}
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
              and ${branchVisibilityPredicate(input.userId)}
          )::int
        `,
        totalNodeCount: sql<number>`count(${conversationMessages.id})::int`,
        archivedAt: conversations.archivedAt,
        deletedAt: conversations.deletedAt,
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
        archivedAt: toIso(row.archivedAt),
        deletedAt: toIso(row.deletedAt),
      })),
    };
  }

  async getConversation(input: {
    userId: string;
    conversationId: string;
    scope?: "active" | "archived" | "deleted";
    branchId?: string;
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
              and ${input.branchId ? branchSelectionPredicate(input.userId, input.branchId) : branchVisibilityPredicate(input.userId)}
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
              and ${input.branchId ? branchSelectionPredicate(input.userId, input.branchId) : branchVisibilityPredicate(input.userId)}
          )::int
        `,
        totalNodeCount: sql<number>`count(${conversationMessages.id})::int`,
        archivedAt: conversations.archivedAt,
        deletedAt: conversations.deletedAt,
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
        lifecyclePredicate(input.scope, input.userId, conversations.id, input.branchId),
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
      archivedAt: toIso(row.archivedAt),
      deletedAt: toIso(row.deletedAt),
    } : null;
  }

  async listMessages(input: {
    userId: string;
    conversationId: string;
    provider: ConversationProvider;
    view: "default" | "all";
    limit: number;
    offset: number;
    scope?: "active" | "archived" | "deleted";
    branchId?: string;
  }): Promise<{ items: ConversationArchiveMessage[]; total: number }> {
    const visibility = messageVisibility(input.provider, input.view);
    const where = and(
      eq(conversationMessages.userId, input.userId),
      eq(conversationMessages.conversationId, input.conversationId),
      visibility,
      input.branchId ? branchSelectionPredicate(input.userId, input.branchId) : branchVisibilityPredicate(input.userId),
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

  async readMessagePayloads(input: {
    userId: string;
    messageIds: string[];
  }): Promise<Record<string, ConversationArchiveMessagePayload>> {
    if (input.messageIds.length === 0) return {};

    const [blocks, attachments] = await Promise.all([
      this.db
        .select({
          messageId: conversationContentBlocks.messageId,
          ordinal: conversationContentBlocks.ordinal,
          kind: conversationContentBlocks.kind,
          rawType: conversationContentBlocks.rawType,
          text: conversationContentBlocks.text,
          payload: conversationContentBlocks.payload,
        })
        .from(conversationContentBlocks)
        .where(and(
          eq(conversationContentBlocks.userId, input.userId),
          inArray(conversationContentBlocks.messageId, input.messageIds),
        ))
        .orderBy(
          asc(conversationContentBlocks.messageId),
          asc(conversationContentBlocks.ordinal),
        ),
      this.db
        .select({
          messageId: conversationAttachments.messageId,
          ordinal: conversationAttachments.ordinal,
          sourceAttachmentId: conversationAttachments.sourceAttachmentId,
          name: conversationAttachments.name,
          mimeType: conversationAttachments.mimeType,
          sizeBytes: conversationAttachments.sizeBytes,
          payload: conversationAttachments.payload,
        })
        .from(conversationAttachments)
        .where(and(
          eq(conversationAttachments.userId, input.userId),
          inArray(conversationAttachments.messageId, input.messageIds),
        ))
        .orderBy(
          asc(conversationAttachments.messageId),
          asc(conversationAttachments.ordinal),
        ),
    ]);

    const result: Record<string, ConversationArchiveMessagePayload> = {};
    for (const messageId of input.messageIds) {
      result[messageId] = { contentBlocks: [], attachments: [] };
    }
    for (const block of blocks) {
      result[block.messageId] ??= { contentBlocks: [], attachments: [] };
      result[block.messageId]!.contentBlocks.push({
        ordinal: block.ordinal,
        kind: block.kind as ConversationContentKind,
        rawType: block.rawType,
        text: block.text,
        payload: block.payload,
      });
    }
    for (const attachment of attachments) {
      result[attachment.messageId] ??= { contentBlocks: [], attachments: [] };
      result[attachment.messageId]!.attachments.push({
        ordinal: attachment.ordinal,
        sourceAttachmentId: attachment.sourceAttachmentId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        payload: attachment.payload,
      });
    }
    return result;
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
    favoritesOnly?: boolean;
    limit: number;
    offset: number;
    scope?: "active" | "archived" | "deleted";
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
      input.favoritesOnly
        ? sql`exists (
            select 1
            from ${conversationFavoriteMessages}
            where ${conversationFavoriteMessages.userId} = ${input.userId}
              and ${conversationFavoriteMessages.messageId} = ${conversationMessages.id}
          )`
        : undefined,
      lifecyclePredicate(input.scope),
      branchVisibilityPredicate(input.userId),
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
    branchId?: string;
  }): Promise<{ index: number; total: number } | null> {
    const rows = await this.db
      .select({ id: conversationMessages.id })
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.userId, input.userId),
        eq(conversationMessages.conversationId, input.conversationId),
        messageVisibility(input.provider, input.view),
        input.branchId ? branchSelectionPredicate(input.userId, input.branchId) : branchVisibilityPredicate(input.userId),
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
