import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationDeletedBranches,
  conversationExclusions,
  conversationMessages,
  conversations,
  users,
} from "../../database/schema.js";
import { hashCanonical } from "../import/import-canonical.js";
import type { ConversationProvider } from "./conversation-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;

const DELETE_BATCH = 2_000;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(values.slice(offset, offset + size));
  }
  return output;
}

export type ConversationPruneConversationResult = {
  provider: ConversationProvider;
  sourceConversationId: string;
  deletedMessages: number;
  deletedAt?: string;
};

export type ConversationPruneBranchResult = {
  provider: ConversationProvider;
  sourceConversationId: string;
  sourceNodeId: string;
  deletedMessages: number;
  remainingMessages: number;
  currentLeafSourceNodeId: string | null;
  deletedAt?: string;
};

export type ConversationDeletedBranchListItem = ConversationPruneBranchResult & {
  id: string;
  conversationId: string;
  title: string | null;
  createdAt: string;
  rootRole: "user" | "assistant" | "system" | "tool" | "reasoning" | "unknown" | null;
  rootSourceCreatedAt: string | null;
  rootSnippet: string | null;
};

export interface ConversationPruningRepository {
  findUserStatus(userId: string): Promise<"active" | "disabled" | null>;
  pruneConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<ConversationPruneConversationResult | null>;
  pruneBranch(input: {
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<ConversationPruneBranchResult | null>;
  archiveConversation?(input: { userId: string; conversationId: string }): Promise<boolean>;
  restoreConversation?(input: { userId: string; conversationId: string }): Promise<boolean>;
  restoreDeletedConversation?(input: { userId: string; conversationId: string }): Promise<boolean>;
  permanentDeleteConversation?(input: { userId: string; conversationId: string }): Promise<ConversationPruneConversationResult | null>;
  restoreBranch?(input: { userId: string; conversationId: string; branchId: string }): Promise<boolean>;
  permanentDeleteBranch?(input: { userId: string; conversationId: string; branchId: string }): Promise<ConversationPruneBranchResult | null>;
  listDeletedBranches?(input: { userId: string; limit: number; offset: number }): Promise<{ items: ConversationDeletedBranchListItem[]; total: number }>;
}

export class DrizzleConversationPruningRepository
implements ConversationPruningRepository {
  constructor(private readonly db: Database) {}

  async findUserStatus(userId: string): Promise<"active" | "disabled" | null> {
    const [row] = await this.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.status ?? null;
  }

  async pruneConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<ConversationPruneConversationResult | null> {
    return this.db.transaction(async (transaction) => {
      const [conversation] = await transaction
        .select({
          id: conversations.id,
          provider: conversations.provider,
          sourceConversationId: conversations.sourceConversationId,
        })
        .from(conversations)
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
        ))
        .for("update")
        .limit(1);
      if (!conversation) return null;

      const messageRows = await transaction
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(and(
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.conversationId, conversation.id),
        ));
      await transaction
        .update(conversations)
        .set({ deletedAt: new Date(), archivedAt: null, updatedAt: new Date() })
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, conversation.id),
        ));

      return {
        provider: conversation.provider,
        sourceConversationId: conversation.sourceConversationId,
        deletedMessages: messageRows.length,
        deletedAt: new Date().toISOString(),
      };
    }, { isolationLevel: "serializable" });
  }

  async pruneBranch(input: {
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<ConversationPruneBranchResult | null> {
    return this.db.transaction(
      async (transaction) => this.pruneBranchInTransaction(transaction as Transaction, input),
      { isolationLevel: "serializable" },
    );
  }

  private async pruneBranchInTransaction(
    transaction: Transaction,
    input: { userId: string; conversationId: string; messageId: string },
  ): Promise<ConversationPruneBranchResult | null> {
    const [conversation] = await transaction
      .select({
        id: conversations.id,
        provider: conversations.provider,
        sourceConversationId: conversations.sourceConversationId,
        currentLeafSourceNodeId: conversations.currentLeafSourceNodeId,
        sourceFingerprint: conversations.sourceFingerprint,
      })
      .from(conversations)
      .where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, input.conversationId),
      ))
      .for("update")
      .limit(1);
    if (!conversation) return null;

    const messages = await transaction
      .select({
        id: conversationMessages.id,
        sourceNodeId: conversationMessages.sourceNodeId,
        parentSourceNodeId: conversationMessages.parentSourceNodeId,
        isCurrentPath: conversationMessages.isCurrentPath,
        currentPathIndex: conversationMessages.currentPathIndex,
      })
      .from(conversationMessages)
      .where(and(
        eq(conversationMessages.userId, input.userId),
        eq(conversationMessages.conversationId, conversation.id),
      ))
      .for("update");

    const root = messages.find((message) => message.id === input.messageId);
    if (!root) return null;

    const children = new Map<string, string[]>();
    const bySourceNode = new Map(messages.map((message) => [message.sourceNodeId, message]));
    for (const message of messages) {
      if (!message.parentSourceNodeId) continue;
      const list = children.get(message.parentSourceNodeId) ?? [];
      list.push(message.sourceNodeId);
      children.set(message.parentSourceNodeId, list);
    }

    const excludedSourceNodes = new Set<string>();
    const queue = [root.sourceNodeId];
    while (queue.length > 0) {
      const sourceNodeId = queue.pop()!;
      if (excludedSourceNodes.has(sourceNodeId)) continue;
      excludedSourceNodes.add(sourceNodeId);
      for (const child of children.get(sourceNodeId) ?? []) queue.push(child);
    }

    const deletedRows = [...excludedSourceNodes]
      .map((sourceNodeId) => bySourceNode.get(sourceNodeId))
      .filter((row): row is (typeof messages)[number] => Boolean(row));
    if (deletedRows.length >= messages.length) {
      throw Object.assign(
        new Error("Deleting this branch would remove the entire conversation."),
        { code: "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED" },
      );
    }

    const [deletedBranch] = await transaction
      .insert(conversationDeletedBranches)
      .values({
        userId: input.userId,
        conversationId: conversation.id,
        provider: conversation.provider,
        sourceConversationId: conversation.sourceConversationId,
        sourceNodeId: root.sourceNodeId,
      })
      .onConflictDoNothing()
      .returning({ id: conversationDeletedBranches.id, deletedAt: conversationDeletedBranches.deletedAt });

    const remaining = messages.filter(
      (message) => !excludedSourceNodes.has(message.sourceNodeId),
    );
    let currentLeafSourceNodeId = conversation.currentLeafSourceNodeId;
    if (
      currentLeafSourceNodeId
      && excludedSourceNodes.has(currentLeafSourceNodeId)
    ) {
      currentLeafSourceNodeId = remaining
        .filter(
          (message) =>
            message.isCurrentPath
            && message.currentPathIndex !== null,
        )
        .sort(
          (left, right) =>
            (left.currentPathIndex ?? -1) - (right.currentPathIndex ?? -1),
        )
        .at(-1)?.sourceNodeId ?? null;
    }

    return {
      provider: conversation.provider,
      sourceConversationId: conversation.sourceConversationId,
      sourceNodeId: root.sourceNodeId,
      deletedMessages: deletedRows.length,
      remainingMessages: remaining.length,
      currentLeafSourceNodeId,
      deletedAt: deletedBranch?.deletedAt.toISOString() ?? new Date().toISOString(),
    };
  }

  async archiveConversation(input: { userId: string; conversationId: string }): Promise<boolean> {
    const rows = await this.db.update(conversations)
      .set({ archivedAt: new Date(), deletedAt: null, updatedAt: new Date() })
      .where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, input.conversationId),
        sql`${conversations.deletedAt} IS NULL`,
        sql`${conversations.archivedAt} IS NULL`,
      ))
      .returning({ id: conversations.id });
    return rows.length > 0;
  }

  async restoreConversation(input: { userId: string; conversationId: string }): Promise<boolean> {
    const rows = await this.db.update(conversations)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, input.conversationId),
        sql`${conversations.archivedAt} IS NOT NULL`,
      ))
      .returning({ id: conversations.id });
    return rows.length > 0;
  }

  async restoreDeletedConversation(input: { userId: string; conversationId: string }): Promise<boolean> {
    const rows = await this.db.update(conversations)
      .set({ deletedAt: null, archivedAt: null, updatedAt: new Date() })
      .where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, input.conversationId),
        sql`${conversations.deletedAt} IS NOT NULL`,
      ))
      .returning({ id: conversations.id });
    return rows.length > 0;
  }

  async permanentDeleteConversation(input: { userId: string; conversationId: string }): Promise<ConversationPruneConversationResult | null> {
    return this.db.transaction(async (transaction) => {
      const [conversation] = await transaction.select({
        id: conversations.id,
        provider: conversations.provider,
        sourceConversationId: conversations.sourceConversationId,
      }).from(conversations).where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, input.conversationId),
        sql`${conversations.deletedAt} IS NOT NULL`,
      )).for("update").limit(1);
      if (!conversation) return null;
      const rows = await transaction.select({ id: conversationMessages.id }).from(conversationMessages).where(and(
        eq(conversationMessages.userId, input.userId),
        eq(conversationMessages.conversationId, conversation.id),
      ));
      await transaction.insert(conversationExclusions).values({
        userId: input.userId,
        provider: conversation.provider,
        scope: "conversation",
        sourceConversationId: conversation.sourceConversationId,
        sourceNodeId: null,
      }).onConflictDoNothing();
      await transaction.delete(conversations).where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, conversation.id),
      ));
      return {
        provider: conversation.provider,
        sourceConversationId: conversation.sourceConversationId,
        deletedMessages: rows.length,
      };
    }, { isolationLevel: "serializable" });
  }

  async restoreBranch(input: { userId: string; conversationId: string; branchId: string }): Promise<boolean> {
    const rows = await this.db.delete(conversationDeletedBranches).where(and(
      eq(conversationDeletedBranches.userId, input.userId),
      eq(conversationDeletedBranches.conversationId, input.conversationId),
      eq(conversationDeletedBranches.id, input.branchId),
    )).returning({ id: conversationDeletedBranches.id });
    return rows.length > 0;
  }

  async permanentDeleteBranch(input: { userId: string; conversationId: string; branchId: string }): Promise<ConversationPruneBranchResult | null> {
    return this.db.transaction(async (transaction) => {
      const [branch] = await transaction.select({
        id: conversationDeletedBranches.id,
        provider: conversationDeletedBranches.provider,
        sourceConversationId: conversationDeletedBranches.sourceConversationId,
        sourceNodeId: conversationDeletedBranches.sourceNodeId,
      }).from(conversationDeletedBranches).where(and(
        eq(conversationDeletedBranches.userId, input.userId),
        eq(conversationDeletedBranches.conversationId, input.conversationId),
        eq(conversationDeletedBranches.id, input.branchId),
      )).for("update").limit(1);
      if (!branch) return null;
      const [conversation] = await transaction.select({
        id: conversations.id,
        currentLeafSourceNodeId: conversations.currentLeafSourceNodeId,
        sourceFingerprint: conversations.sourceFingerprint,
      }).from(conversations).where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, input.conversationId),
      )).for("update").limit(1);
      if (!conversation) return null;
      const rows = await transaction.select({
        id: conversationMessages.id,
        sourceNodeId: conversationMessages.sourceNodeId,
        parentSourceNodeId: conversationMessages.parentSourceNodeId,
        isCurrentPath: conversationMessages.isCurrentPath,
        currentPathIndex: conversationMessages.currentPathIndex,
      }).from(conversationMessages).where(and(
        eq(conversationMessages.userId, input.userId),
        eq(conversationMessages.conversationId, input.conversationId),
      )).for("update");
      const children = new Map<string, string[]>();
      for (const row of rows) {
        if (row.parentSourceNodeId) children.set(row.parentSourceNodeId, [
          ...(children.get(row.parentSourceNodeId) ?? []),
          row.sourceNodeId,
        ]);
      }
      const excluded = new Set<string>();
      const queue = [branch.sourceNodeId];
      while (queue.length > 0) {
        const node = queue.pop()!;
        if (excluded.has(node)) continue;
        excluded.add(node);
        queue.push(...(children.get(node) ?? []));
      }
      const ids = rows.filter((row) => excluded.has(row.sourceNodeId)).map((row) => row.id);
      if (ids.length >= rows.length) {
        throw Object.assign(new Error("Deleting this branch would remove the entire conversation."), {
          code: "CONVERSATION_PRUNE_WHOLE_WINDOW_REQUIRED",
        });
      }
      const remaining = rows.filter((row) => !excluded.has(row.sourceNodeId));
      let currentLeafSourceNodeId = conversation.currentLeafSourceNodeId;
      if (currentLeafSourceNodeId && excluded.has(currentLeafSourceNodeId)) {
        currentLeafSourceNodeId = remaining
          .filter((row) => row.isCurrentPath && row.currentPathIndex !== null)
          .sort((left, right) => (left.currentPathIndex ?? -1) - (right.currentPathIndex ?? -1))
          .at(-1)?.sourceNodeId ?? null;
      }
      const sourceFingerprint = hashCanonical({
        previous: conversation.sourceFingerprint,
        exclusion: {
          scope: "branch",
          sourceNodeId: branch.sourceNodeId,
        },
        currentLeafSourceNodeId,
      });
      await transaction.insert(conversationExclusions).values({
        userId: input.userId,
        provider: branch.provider,
        scope: "branch",
        sourceConversationId: branch.sourceConversationId,
        sourceNodeId: branch.sourceNodeId,
      }).onConflictDoNothing();
      await transaction.update(conversations).set({
        currentLeafSourceNodeId,
        sourceFingerprint,
        updatedAt: new Date(),
      }).where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, input.conversationId),
      ));
      for (const idChunk of chunks(ids, DELETE_BATCH)) {
        await transaction.delete(conversationMessages).where(and(
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.conversationId, input.conversationId),
          inArray(conversationMessages.id, idChunk),
        ));
      }
      await transaction.delete(conversationDeletedBranches).where(eq(conversationDeletedBranches.id, branch.id));
      return {
        provider: branch.provider,
        sourceConversationId: branch.sourceConversationId,
        sourceNodeId: branch.sourceNodeId,
        deletedMessages: ids.length,
        remainingMessages: remaining.length,
        currentLeafSourceNodeId,
      };
    }, { isolationLevel: "serializable" });
  }

  async listDeletedBranches(input: { userId: string; limit: number; offset: number }): Promise<{ items: ConversationDeletedBranchListItem[]; total: number }> {
    const where = eq(conversationDeletedBranches.userId, input.userId);
    const [count] = await this.db.select({ total: sql<number>`count(*)::int` }).from(conversationDeletedBranches).where(where);
    const rows = await this.db.select({
      id: conversationDeletedBranches.id,
      conversationId: conversationDeletedBranches.conversationId,
      provider: conversationDeletedBranches.provider,
      sourceConversationId: conversationDeletedBranches.sourceConversationId,
      sourceNodeId: conversationDeletedBranches.sourceNodeId,
      deletedAt: conversationDeletedBranches.deletedAt,
      createdAt: conversationDeletedBranches.createdAt,
      title: conversations.title,
      rootRole: conversationMessages.role,
      rootSourceCreatedAt: conversationMessages.sourceCreatedAt,
      rootSnippet: conversationMessages.displayText,
    }).from(conversationDeletedBranches).innerJoin(conversations, and(
      eq(conversations.id, conversationDeletedBranches.conversationId),
      eq(conversations.userId, conversationDeletedBranches.userId),
    )).leftJoin(conversationMessages, and(
      eq(conversationMessages.userId, input.userId),
      eq(conversationMessages.conversationId, conversations.id),
      eq(conversationMessages.sourceNodeId, conversationDeletedBranches.sourceNodeId),
    )).where(where).orderBy(desc(conversationDeletedBranches.deletedAt), desc(conversationDeletedBranches.id)).limit(input.limit).offset(input.offset);
    return {
      total: count?.total ?? 0,
      items: rows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        provider: row.provider as ConversationProvider,
        sourceConversationId: row.sourceConversationId,
        sourceNodeId: row.sourceNodeId,
        title: row.title,
        deletedMessages: 0,
        remainingMessages: 0,
        currentLeafSourceNodeId: null,
        canonicalConversationExists: true,
        deletedAt: row.deletedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        rootRole: row.rootRole as ConversationDeletedBranchListItem["rootRole"],
        rootSourceCreatedAt: row.rootSourceCreatedAt?.toISOString() ?? null,
        rootSnippet: row.rootSnippet,
      })),
    };
  }
}
