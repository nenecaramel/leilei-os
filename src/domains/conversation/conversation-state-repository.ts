import { asc, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationMessages,
  conversations,
} from "../../database/schema.js";
import type { ConversationProvider } from "./conversation-types.js";
import type {
  ConversationMergeCurrentState,
  CurrentConversationMessageState,
  CurrentConversationState,
} from "./conversation-merge-planner.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;
type DbExecutor = Database | Transaction;

export interface ConversationArchiveStateRepository {
  withTransaction<T>(
    work: (repository: ConversationArchiveStateRepository) => Promise<T>,
  ): Promise<T>;
  readMergeState(userId: string): Promise<ConversationMergeCurrentState>;
}

export class DrizzleConversationArchiveStateRepository
implements ConversationArchiveStateRepository {
  constructor(private readonly db: DbExecutor) {}

  async withTransaction<T>(
    work: (repository: ConversationArchiveStateRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      async (transaction) => work(
        new DrizzleConversationArchiveStateRepository(transaction as Transaction),
      ),
      { isolationLevel: "serializable" },
    );
  }

  async readMergeState(userId: string): Promise<ConversationMergeCurrentState> {
    const conversationRows = await this.db
      .select({
        id: conversations.id,
        provider: conversations.provider,
        sourceConversationId: conversations.sourceConversationId,
        sourceFingerprint: conversations.sourceFingerprint,
        sourceCreatedAt: conversations.sourceCreatedAt,
        sourceUpdatedAt: conversations.sourceUpdatedAt,
      })
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(asc(conversations.provider), asc(conversations.sourceConversationId));

    if (conversationRows.length === 0) return { conversations: [] };

    const messageRows = await this.db
      .select({
        id: conversationMessages.id,
        conversationId: conversationMessages.conversationId,
        sourceNodeId: conversationMessages.sourceNodeId,
        sourceFingerprint: conversationMessages.sourceFingerprint,
        sourceCreatedAt: conversationMessages.sourceCreatedAt,
        sourceUpdatedAt: conversationMessages.sourceUpdatedAt,
        isCurrentPath: conversationMessages.isCurrentPath,
        currentPathIndex: conversationMessages.currentPathIndex,
        turnIndex: conversationMessages.turnIndex,
      })
      .from(conversationMessages)
      .where(inArray(
        conversationMessages.conversationId,
        conversationRows.map((conversation) => conversation.id),
      ))
      .orderBy(
        asc(conversationMessages.conversationId),
        asc(conversationMessages.sourceNodeId),
      );

    const messagesByConversation = new Map<string, CurrentConversationMessageState[]>();
    for (const row of messageRows) {
      const messages = messagesByConversation.get(row.conversationId) ?? [];
      messages.push({
        id: row.id,
        sourceNodeId: row.sourceNodeId,
        sourceFingerprint: row.sourceFingerprint,
        sourceCreatedAt: row.sourceCreatedAt?.toISOString() ?? null,
        sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
        isCurrentPath: row.isCurrentPath,
        currentPathIndex: row.currentPathIndex,
        turnIndex: row.turnIndex,
      });
      messagesByConversation.set(row.conversationId, messages);
    }

    const currentConversations: CurrentConversationState[] = conversationRows.map(
      (row) => ({
        id: row.id,
        provider: row.provider as ConversationProvider,
        sourceConversationId: row.sourceConversationId,
        sourceFingerprint: row.sourceFingerprint,
        sourceCreatedAt: row.sourceCreatedAt?.toISOString() ?? null,
        sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
        messages: messagesByConversation.get(row.id) ?? [],
      }),
    );

    return { conversations: currentConversations };
  }
}
