import { and, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
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
};

export type ConversationPruneBranchResult = {
  provider: ConversationProvider;
  sourceConversationId: string;
  sourceNodeId: string;
  deletedMessages: number;
  remainingMessages: number;
  currentLeafSourceNodeId: string | null;
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
        .insert(conversationExclusions)
        .values({
          userId: input.userId,
          provider: conversation.provider,
          scope: "conversation",
          sourceConversationId: conversation.sourceConversationId,
          sourceNodeId: null,
        })
        .onConflictDoNothing();

      await transaction
        .delete(conversations)
        .where(and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, conversation.id),
        ));

      return {
        provider: conversation.provider,
        sourceConversationId: conversation.sourceConversationId,
        deletedMessages: messageRows.length,
      };
    }, { isolationLevel: "serializable" });
  }

  async pruneBranch(input: {
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<ConversationPruneBranchResult | null> {
    return this.db.transaction(
      async (transaction) => this.pruneBranchInTransaction(transaction, input),
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

    await transaction
      .insert(conversationExclusions)
      .values({
        userId: input.userId,
        provider: conversation.provider,
        scope: "branch",
        sourceConversationId: conversation.sourceConversationId,
        sourceNodeId: root.sourceNodeId,
      })
      .onConflictDoNothing();

    for (const idChunk of chunks(deletedRows.map((row) => row.id), DELETE_BATCH)) {
      await transaction
        .delete(conversationMessages)
        .where(and(
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.conversationId, conversation.id),
          inArray(conversationMessages.id, idChunk),
        ));
    }

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

    await transaction
      .update(conversations)
      .set({
        currentLeafSourceNodeId,
        sourceFingerprint: hashCanonical({
          previous: conversation.sourceFingerprint,
          exclusion: {
            scope: "branch",
            sourceNodeId: root.sourceNodeId,
          },
          currentLeafSourceNodeId,
        }),
        updatedAt: new Date(),
      })
      .where(and(
        eq(conversations.userId, input.userId),
        eq(conversations.id, conversation.id),
      ));

    return {
      provider: conversation.provider,
      sourceConversationId: conversation.sourceConversationId,
      sourceNodeId: root.sourceNodeId,
      deletedMessages: deletedRows.length,
      remainingMessages: remaining.length,
      currentLeafSourceNodeId,
    };
  }
}
