import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationAttachments,
  conversationContentBlocks,
  conversationFavoriteMessages,
  conversationFavorites,
  conversationMessages,
  conversations,
  users,
  type ConversationFavoriteView,
  type ConversationMessageRole,
  type ConversationProvider,
} from "../../database/schema.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type ConversationFavoriteListItem = {
  id: string;
  provider: ConversationProvider;
  sourceConversationId: string;
  conversationId: string;
  view: ConversationFavoriteView;
  title: string | null;
  note: string | null;
  tags: string[];
  conversationTitleSnapshot: string | null;
  startMessageId: string;
  endMessageId: string;
  startSourceNodeId: string;
  endSourceNodeId: string;
  messageCount: number;
  canonicalConversationExists: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConversationFavoriteMessage = {
  ordinal: number;
  messageId: string;
  sourceNodeId: string;
  sourceMessageId: string | null;
  role: ConversationMessageRole;
  model: string | null;
  sourceCreatedAt: string | null;
  displayText: string;
  snapshot: Record<string, unknown>;
  canonicalMessageExists: boolean;
};

export type ConversationFavoriteDetail = ConversationFavoriteListItem & {
  messages: ConversationFavoriteMessage[];
};

export interface ConversationFavoriteRepository {
  findUserStatus(userId: string): Promise<"active" | "disabled" | null>;
  createFavorite(input: {
    userId: string;
    conversationId: string;
    startMessageId: string;
    endMessageId: string;
    view: ConversationFavoriteView;
    title: string | null;
    note: string | null;
    tags: string[];
  }): Promise<string>;
  listFavorites(input: {
    userId: string;
    provider?: ConversationProvider;
    conversationId?: string;
    tag?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationFavoriteListItem[]; total: number }>;
  getFavorite(input: {
    userId: string;
    favoriteId: string;
  }): Promise<ConversationFavoriteDetail | null>;
  updateFavorite(input: {
    userId: string;
    favoriteId: string;
    title?: string | null;
    note?: string | null;
    tags?: string[];
  }): Promise<boolean>;
  deleteFavorite(input: {
    userId: string;
    favoriteId: string;
  }): Promise<boolean>;
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function visibility(provider: ConversationProvider, view: ConversationFavoriteView) {
  const ordinary = and(
    eq(conversationMessages.isPrimary, true),
    inArray(conversationMessages.role, ["user", "assistant"]),
  );
  if (provider === "chatgpt" && view === "default") {
    return and(ordinary, eq(conversationMessages.isCurrentPath, true));
  }
  return ordinary;
}

function order(provider: ConversationProvider, view: ConversationFavoriteView) {
  return provider === "chatgpt" && view === "default"
    ? [asc(conversationMessages.currentPathIndex), asc(conversationMessages.id)] as const
    : [asc(conversationMessages.sourceCreatedAt), asc(conversationMessages.id)] as const;
}

function favoriteListRow(row: {
  id: string;
  provider: ConversationProvider;
  sourceConversationId: string;
  conversationId: string;
  view: ConversationFavoriteView;
  title: string | null;
  note: string | null;
  tags: string[];
  conversationTitleSnapshot: string | null;
  startMessageId: string;
  endMessageId: string;
  startSourceNodeId: string;
  endSourceNodeId: string;
  messageCount: number;
  canonicalConversationExists: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ConversationFavoriteListItem {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleConversationFavoriteRepository
implements ConversationFavoriteRepository {
  constructor(private readonly db: Database) {}

  async findUserStatus(userId: string): Promise<"active" | "disabled" | null> {
    const [row] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.status ?? null;
  }

  async createFavorite(input: {
    userId: string;
    conversationId: string;
    startMessageId: string;
    endMessageId: string;
    view: ConversationFavoriteView;
    title: string | null;
    note: string | null;
    tags: string[];
  }): Promise<string> {
    return this.db.transaction(async (transaction) => {
      const [conversation] = await transaction
        .select({
          id: conversations.id,
          provider: conversations.provider,
          sourceConversationId: conversations.sourceConversationId,
          title: conversations.title,
        })
        .from(conversations)
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
        ))
        .for("share")
        .limit(1);
      if (!conversation) {
        throw Object.assign(new Error("Conversation not found."), {
          code: "CONVERSATION_FAVORITE_RANGE_NOT_FOUND",
        });
      }

      const messages = await transaction
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
        .where(and(
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.conversationId, conversation.id),
          visibility(conversation.provider, input.view),
        ))
        .orderBy(...order(conversation.provider, input.view))
        .for("share");

      const startIndex = messages.findIndex((message) => message.id === input.startMessageId);
      const endIndex = messages.findIndex((message) => message.id === input.endMessageId);
      if (startIndex < 0 || endIndex < 0) {
        throw Object.assign(new Error("Favorite range message was not found in this view."), {
          code: "CONVERSATION_FAVORITE_RANGE_NOT_FOUND",
        });
      }
      const lower = Math.min(startIndex, endIndex);
      const upper = Math.max(startIndex, endIndex);
      const selected = messages.slice(lower, upper + 1);
      if (selected.length > 200) {
        throw Object.assign(new Error("Favorite range is too large."), {
          code: "CONVERSATION_FAVORITE_RANGE_TOO_LARGE",
        });
      }

      const messageIds = selected.map((message) => message.id);
      const [blocks, attachments] = await Promise.all([
        transaction
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
            inArray(conversationContentBlocks.messageId, messageIds),
          ))
          .orderBy(
            asc(conversationContentBlocks.messageId),
            asc(conversationContentBlocks.ordinal),
          ),
        transaction
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
            inArray(conversationAttachments.messageId, messageIds),
          ))
          .orderBy(
            asc(conversationAttachments.messageId),
            asc(conversationAttachments.ordinal),
          ),
      ]);

      const blocksByMessage = new Map<string, typeof blocks>();
      for (const block of blocks) {
        const list = blocksByMessage.get(block.messageId) ?? [];
        list.push(block);
        blocksByMessage.set(block.messageId, list);
      }
      const attachmentsByMessage = new Map<string, typeof attachments>();
      for (const attachment of attachments) {
        const list = attachmentsByMessage.get(attachment.messageId) ?? [];
        list.push(attachment);
        attachmentsByMessage.set(attachment.messageId, list);
      }

      const first = selected[0]!;
      const last = selected.at(-1)!;
      const [favorite] = await transaction
        .insert(conversationFavorites)
        .values({
          userId: input.userId,
          provider: conversation.provider,
          sourceConversationId: conversation.sourceConversationId,
          conversationId: conversation.id,
          view: input.view,
          title: input.title,
          note: input.note,
          tags: input.tags,
          conversationTitleSnapshot: conversation.title,
          startMessageId: first.id,
          endMessageId: last.id,
          startSourceNodeId: first.sourceNodeId,
          endSourceNodeId: last.sourceNodeId,
          messageCount: selected.length,
        })
        .returning({ id: conversationFavorites.id });
      if (!favorite) throw new Error("Conversation favorite insert failed.");

      await transaction.insert(conversationFavoriteMessages).values(
        selected.map((message, ordinal) => ({
          favoriteId: favorite.id,
          userId: input.userId,
          ordinal,
          messageId: message.id,
          sourceNodeId: message.sourceNodeId,
          sourceMessageId: message.sourceMessageId,
          role: message.role,
          model: message.model,
          sourceCreatedAt: message.sourceCreatedAt,
          displayText: message.displayText,
          snapshot: {
            version: 1,
            message: {
              id: message.id,
              sourceNodeId: message.sourceNodeId,
              sourceMessageId: message.sourceMessageId,
              parentSourceNodeId: message.parentSourceNodeId,
              role: message.role,
              rawRole: message.rawRole,
              model: message.model,
              sourceCreatedAt: toIso(message.sourceCreatedAt),
              sourceUpdatedAt: toIso(message.sourceUpdatedAt),
              isCurrentPath: message.isCurrentPath,
              currentPathIndex: message.currentPathIndex,
              turnIndex: message.turnIndex,
              isPrimary: message.isPrimary,
              displayText: message.displayText,
            },
            contentBlocks: (blocksByMessage.get(message.id) ?? []).map((block) => ({
              ordinal: block.ordinal,
              kind: block.kind,
              rawType: block.rawType,
              text: block.text,
              payload: block.payload,
            })),
            attachments: (attachmentsByMessage.get(message.id) ?? []).map((attachment) => ({
              ordinal: attachment.ordinal,
              sourceAttachmentId: attachment.sourceAttachmentId,
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: attachment.sizeBytes,
              payload: attachment.payload,
            })),
          },
        })),
      );

      return favorite.id;
    }, { isolationLevel: "serializable" });
  }

  async listFavorites(input: {
    userId: string;
    provider?: ConversationProvider;
    conversationId?: string;
    tag?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: ConversationFavoriteListItem[]; total: number }> {
    const where = and(
      eq(conversationFavorites.userId, input.userId),
      input.provider ? eq(conversationFavorites.provider, input.provider) : undefined,
      input.conversationId
        ? eq(conversationFavorites.conversationId, input.conversationId)
        : undefined,
      input.tag
        ? sql`exists (
            select 1
            from jsonb_array_elements_text(${conversationFavorites.tags}) as favorite_tag(value)
            where lower(favorite_tag.value) = lower(${input.tag})
          )`
        : undefined,
    );
    const [countRow] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(conversationFavorites)
      .where(where);

    const rows = await this.db
      .select({
        id: conversationFavorites.id,
        provider: conversationFavorites.provider,
        sourceConversationId: conversationFavorites.sourceConversationId,
        conversationId: conversationFavorites.conversationId,
        view: conversationFavorites.view,
        title: conversationFavorites.title,
        note: conversationFavorites.note,
        tags: conversationFavorites.tags,
        conversationTitleSnapshot: conversationFavorites.conversationTitleSnapshot,
        startMessageId: conversationFavorites.startMessageId,
        endMessageId: conversationFavorites.endMessageId,
        startSourceNodeId: conversationFavorites.startSourceNodeId,
        endSourceNodeId: conversationFavorites.endSourceNodeId,
        messageCount: conversationFavorites.messageCount,
        canonicalConversationExists: sql<boolean>`${conversations.id} is not null`,
        createdAt: conversationFavorites.createdAt,
        updatedAt: conversationFavorites.updatedAt,
      })
      .from(conversationFavorites)
      .leftJoin(
        conversations,
        and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, conversationFavorites.conversationId),
        ),
      )
      .where(where)
      .orderBy(desc(conversationFavorites.createdAt), desc(conversationFavorites.id))
      .limit(input.limit)
      .offset(input.offset);

    return {
      total: countRow?.total ?? 0,
      items: rows.map(favoriteListRow),
    };
  }

  async getFavorite(input: {
    userId: string;
    favoriteId: string;
  }): Promise<ConversationFavoriteDetail | null> {
    const [favorite] = await this.db
      .select({
        id: conversationFavorites.id,
        provider: conversationFavorites.provider,
        sourceConversationId: conversationFavorites.sourceConversationId,
        conversationId: conversationFavorites.conversationId,
        view: conversationFavorites.view,
        title: conversationFavorites.title,
        note: conversationFavorites.note,
        tags: conversationFavorites.tags,
        conversationTitleSnapshot: conversationFavorites.conversationTitleSnapshot,
        startMessageId: conversationFavorites.startMessageId,
        endMessageId: conversationFavorites.endMessageId,
        startSourceNodeId: conversationFavorites.startSourceNodeId,
        endSourceNodeId: conversationFavorites.endSourceNodeId,
        messageCount: conversationFavorites.messageCount,
        canonicalConversationExists: sql<boolean>`${conversations.id} is not null`,
        createdAt: conversationFavorites.createdAt,
        updatedAt: conversationFavorites.updatedAt,
      })
      .from(conversationFavorites)
      .leftJoin(
        conversations,
        and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, conversationFavorites.conversationId),
        ),
      )
      .where(and(
        eq(conversationFavorites.userId, input.userId),
        eq(conversationFavorites.id, input.favoriteId),
      ))
      .limit(1);
    if (!favorite) return null;

    const rows = await this.db
      .select({
        ordinal: conversationFavoriteMessages.ordinal,
        messageId: conversationFavoriteMessages.messageId,
        sourceNodeId: conversationFavoriteMessages.sourceNodeId,
        sourceMessageId: conversationFavoriteMessages.sourceMessageId,
        role: conversationFavoriteMessages.role,
        model: conversationFavoriteMessages.model,
        sourceCreatedAt: conversationFavoriteMessages.sourceCreatedAt,
        displayText: conversationFavoriteMessages.displayText,
        snapshot: conversationFavoriteMessages.snapshot,
        canonicalMessageExists: sql<boolean>`${conversationMessages.id} is not null`,
      })
      .from(conversationFavoriteMessages)
      .leftJoin(
        conversationMessages,
        and(
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.id, conversationFavoriteMessages.messageId),
        ),
      )
      .where(and(
        eq(conversationFavoriteMessages.userId, input.userId),
        eq(conversationFavoriteMessages.favoriteId, input.favoriteId),
      ))
      .orderBy(asc(conversationFavoriteMessages.ordinal));

    return {
      ...favoriteListRow(favorite),
      messages: rows.map((row) => ({
        ...row,
        role: row.role as ConversationMessageRole,
        sourceCreatedAt: toIso(row.sourceCreatedAt),
      })),
    };
  }

  async updateFavorite(input: {
    userId: string;
    favoriteId: string;
    title?: string | null;
    note?: string | null;
    tags?: string[];
  }): Promise<boolean> {
    const values: Partial<typeof conversationFavorites.$inferInsert> = {
      updatedAt: new Date(),
    };
    if ("title" in input) values.title = input.title;
    if ("note" in input) values.note = input.note;
    if ("tags" in input) values.tags = input.tags;
    const [row] = await this.db
      .update(conversationFavorites)
      .set(values)
      .where(and(
        eq(conversationFavorites.userId, input.userId),
        eq(conversationFavorites.id, input.favoriteId),
      ))
      .returning({ id: conversationFavorites.id });
    return Boolean(row);
  }

  async deleteFavorite(input: {
    userId: string;
    favoriteId: string;
  }): Promise<boolean> {
    const [row] = await this.db
      .delete(conversationFavorites)
      .where(and(
        eq(conversationFavorites.userId, input.userId),
        eq(conversationFavorites.id, input.favoriteId),
      ))
      .returning({ id: conversationFavorites.id });
    return Boolean(row);
  }
}
