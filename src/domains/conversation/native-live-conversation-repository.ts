import { and, asc, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationContentBlocks,
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
} from "../../database/schema.js";
import type {
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
  NativeLiveProviderCheckpointInput,
} from "./native-live-conversation-types.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;
type DbExecutor = Database | Transaction;

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function notFound(): Error {
  return Object.assign(new Error("Native live conversation resource not found."), {
    code: "NATIVE_LIVE_CONVERSATION_NOT_FOUND",
  });
}

export interface NativeLiveConversationRepository {
  withTransaction<T>(
    work: (repository: NativeLiveConversationRepository) => Promise<T>,
  ): Promise<T>;

  createConversation(input: {
    userId: string;
    title?: string | null;
  }): Promise<NativeLiveConversation>;

  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null>;

  appendUserMessage(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string | null;
  }): Promise<NativeLiveMessage>;

  appendAssistantMessage(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string;
  }): Promise<NativeLiveMessage>;

  appendContentBlock(input: {
    userId: string;
    conversationId: string;
    messageId: string;
    ordinal: number;
    block: NativeLiveContentBlockInput;
  }): Promise<void>;

  setCurrentHead(input: {
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<void>;

  bindProviderCheckpoint(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string;
    checkpoint: NativeLiveProviderCheckpointInput;
  }): Promise<NativeLiveProviderCheckpoint>;

  getProviderCheckpointForHead(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string;
  }): Promise<NativeLiveProviderCheckpoint | null>;
}

export class DrizzleNativeLiveConversationRepository
implements NativeLiveConversationRepository {
  constructor(private readonly db: DbExecutor) {}

  async withTransaction<T>(
    work: (repository: NativeLiveConversationRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      async (transaction) =>
        work(
          new DrizzleNativeLiveConversationRepository(
            transaction as Transaction,
          ),
        ),
      { isolationLevel: "serializable" },
    );
  }

  async createConversation(input: {
    userId: string;
    title?: string | null;
  }): Promise<NativeLiveConversation> {
    const [row] = await this.db
      .insert(conversations)
      .values({
        userId: input.userId,
        origin: "native_live",
        title: input.title ?? null,
        lifecycleStatus: "active",
        provider: null,
        sourceConversationId: null,
        sourceFingerprint: null,
        firstSeenImportId: null,
        lastSeenImportId: null,
      })
      .returning({
        id: conversations.id,
        userId: conversations.userId,
        title: conversations.title,
        lifecycleStatus: conversations.lifecycleStatus,
        currentHeadMessageId: conversations.currentHeadMessageId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      });

    if (!row) throw new Error("Native live conversation insert failed.");

    return {
      id: row.id,
      userId: row.userId,
      title: row.title,
      lifecycleStatus: row.lifecycleStatus,
      currentHeadMessageId: row.currentHeadMessageId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      messages: [],
    };
  }

  async getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null> {
    const [conversation] = await this.db
      .select({
        id: conversations.id,
        userId: conversations.userId,
        title: conversations.title,
        lifecycleStatus: conversations.lifecycleStatus,
        currentHeadMessageId: conversations.currentHeadMessageId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
          eq(conversations.origin, "native_live"),
        ),
      )
      .limit(1);

    if (!conversation) return null;

    const messageRows = await this.db
      .select({
        id: conversationMessages.id,
        conversationId: conversationMessages.conversationId,
        parentMessageId: conversationMessages.parentMessageId,
        role: conversationMessages.role,
        status: conversationMessages.status,
        createdAt: conversationMessages.createdAt,
        completedAt: conversationMessages.completedAt,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.userId, input.userId),
          eq(conversationMessages.conversationId, input.conversationId),
        ),
      )
      .orderBy(asc(conversationMessages.createdAt), asc(conversationMessages.id));

    const messageIds = messageRows.map((row) => row.id);
    const blockRows =
      messageIds.length === 0
        ? []
        : await this.db
            .select({
              id: conversationContentBlocks.id,
              messageId: conversationContentBlocks.messageId,
              ordinal: conversationContentBlocks.ordinal,
              kind: conversationContentBlocks.kind,
              rawType: conversationContentBlocks.rawType,
              text: conversationContentBlocks.text,
              payload: conversationContentBlocks.payload,
              createdAt: conversationContentBlocks.createdAt,
            })
            .from(conversationContentBlocks)
            .where(
              and(
                eq(conversationContentBlocks.userId, input.userId),
                inArray(conversationContentBlocks.messageId, messageIds),
              ),
            )
            .orderBy(
              asc(conversationContentBlocks.messageId),
              asc(conversationContentBlocks.ordinal),
            );

    const blocksByMessage = new Map<
      string,
      NativeLiveMessage["blocks"]
    >();

    for (const row of blockRows) {
      if (
        row.kind !== "text" &&
        row.kind !== "tool_use" &&
        row.kind !== "tool_result" &&
        row.kind !== "attachment"
      ) {
        continue;
      }
      const blocks = blocksByMessage.get(row.messageId) ?? [];
      blocks.push({
        id: row.id,
        ordinal: row.ordinal,
        kind: row.kind,
        rawType: row.rawType,
        text: row.text,
        payload: row.payload,
        createdAt: row.createdAt.toISOString(),
      });
      blocksByMessage.set(row.messageId, blocks);
    }

    const messages: NativeLiveMessage[] = messageRows.map((row) => {
      if (row.role !== "user" && row.role !== "assistant") {
        throw new Error("Native live conversation contains an unsupported role.");
      }
      return {
        id: row.id,
        conversationId: row.conversationId,
        parentMessageId: row.parentMessageId,
        role: row.role,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        completedAt: toIso(row.completedAt),
        blocks: blocksByMessage.get(row.id) ?? [],
      };
    });

    return {
      id: conversation.id,
      userId: conversation.userId,
      title: conversation.title,
      lifecycleStatus: conversation.lifecycleStatus,
      currentHeadMessageId: conversation.currentHeadMessageId,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages,
    };
  }

  async appendUserMessage(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string | null;
  }): Promise<NativeLiveMessage> {
    await this.requireNativeConversation(input.userId, input.conversationId);
    if (input.parentMessageId) {
      await this.requireMessage(
        input.userId,
        input.conversationId,
        input.parentMessageId,
      );
    }

    const now = new Date();
    const [row] = await this.db
      .insert(conversationMessages)
      .values({
        userId: input.userId,
        conversationId: input.conversationId,
        parentMessageId: input.parentMessageId,
        role: "user",
        status: "completed",
        completedAt: now,
        sourceNodeId: null,
        sourceFingerprint: null,
        firstSeenImportId: null,
        lastSeenImportId: null,
      })
      .returning({
        id: conversationMessages.id,
        conversationId: conversationMessages.conversationId,
        parentMessageId: conversationMessages.parentMessageId,
        role: conversationMessages.role,
        status: conversationMessages.status,
        createdAt: conversationMessages.createdAt,
        completedAt: conversationMessages.completedAt,
      });

    if (!row) throw new Error("Native live user message insert failed.");

    return {
      id: row.id,
      conversationId: row.conversationId,
      parentMessageId: row.parentMessageId,
      role: "user",
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      completedAt: toIso(row.completedAt),
      blocks: [],
    };
  }

  async appendAssistantMessage(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string;
  }): Promise<NativeLiveMessage> {
    await this.requireNativeConversation(input.userId, input.conversationId);
    const parent = await this.requireMessage(
      input.userId,
      input.conversationId,
      input.parentMessageId,
    );
    if (parent.role !== "user") throw notFound();

    const now = new Date();
    const [row] = await this.db
      .insert(conversationMessages)
      .values({
        userId: input.userId,
        conversationId: input.conversationId,
        parentMessageId: input.parentMessageId,
        role: "assistant",
        status: "completed",
        completedAt: now,
        sourceNodeId: null,
        sourceFingerprint: null,
        firstSeenImportId: null,
        lastSeenImportId: null,
      })
      .returning({
        id: conversationMessages.id,
        conversationId: conversationMessages.conversationId,
        parentMessageId: conversationMessages.parentMessageId,
        role: conversationMessages.role,
        status: conversationMessages.status,
        createdAt: conversationMessages.createdAt,
        completedAt: conversationMessages.completedAt,
      });

    if (!row) throw new Error("Native live assistant message insert failed.");

    return {
      id: row.id,
      conversationId: row.conversationId,
      parentMessageId: row.parentMessageId,
      role: "assistant",
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      completedAt: toIso(row.completedAt),
      blocks: [],
    };
  }

  async appendContentBlock(input: {
    userId: string;
    conversationId: string;
    messageId: string;
    ordinal: number;
    block: NativeLiveContentBlockInput;
  }): Promise<void> {
    await this.requireMessage(
      input.userId,
      input.conversationId,
      input.messageId,
    );

    await this.db.insert(conversationContentBlocks).values({
      userId: input.userId,
      messageId: input.messageId,
      ordinal: input.ordinal,
      kind: input.block.kind,
      rawType: input.block.rawType ?? input.block.kind,
      text: input.block.text ?? null,
      payload: input.block.payload ?? null,
    });
  }

  async setCurrentHead(input: {
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<void> {
    await this.requireMessage(
      input.userId,
      input.conversationId,
      input.messageId,
    );

    const rows = await this.db
      .update(conversations)
      .set({
        currentHeadMessageId: input.messageId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
          eq(conversations.origin, "native_live"),
        ),
      )
      .returning({ id: conversations.id });

    if (rows.length === 0) throw notFound();
  }

  async bindProviderCheckpoint(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string;
    checkpoint: NativeLiveProviderCheckpointInput;
  }): Promise<NativeLiveProviderCheckpoint> {
    const message = await this.requireMessage(
      input.userId,
      input.conversationId,
      input.canonicalMessageId,
    );
    if (message.role !== "assistant" || message.status !== "completed") {
      throw notFound();
    }

    const [row] = await this.db
      .insert(conversationProviderSessionCheckpoints)
      .values({
        userId: input.userId,
        conversationId: input.conversationId,
        canonicalMessageId: input.canonicalMessageId,
        provider: input.checkpoint.provider,
        providerSessionId: input.checkpoint.providerSessionId,
        providerCheckpointId: input.checkpoint.providerCheckpointId ?? null,
      })
      .returning();

    if (!row) throw new Error("Provider checkpoint insert failed.");

    return {
      id: row.id,
      conversationId: row.conversationId,
      canonicalMessageId: row.canonicalMessageId,
      provider: row.provider,
      providerSessionId: row.providerSessionId,
      providerCheckpointId: row.providerCheckpointId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getProviderCheckpointForHead(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string;
  }): Promise<NativeLiveProviderCheckpoint | null> {
    const [row] = await this.db
      .select({
        id: conversationProviderSessionCheckpoints.id,
        conversationId: conversationProviderSessionCheckpoints.conversationId,
        canonicalMessageId:
          conversationProviderSessionCheckpoints.canonicalMessageId,
        provider: conversationProviderSessionCheckpoints.provider,
        providerSessionId:
          conversationProviderSessionCheckpoints.providerSessionId,
        providerCheckpointId:
          conversationProviderSessionCheckpoints.providerCheckpointId,
        createdAt: conversationProviderSessionCheckpoints.createdAt,
      })
      .from(conversationProviderSessionCheckpoints)
      .innerJoin(
        conversations,
        and(
          eq(
            conversations.id,
            conversationProviderSessionCheckpoints.conversationId,
          ),
          eq(
            conversations.userId,
            conversationProviderSessionCheckpoints.userId,
          ),
        ),
      )
      .where(
        and(
          eq(conversationProviderSessionCheckpoints.userId, input.userId),
          eq(
            conversationProviderSessionCheckpoints.conversationId,
            input.conversationId,
          ),
          eq(
            conversationProviderSessionCheckpoints.canonicalMessageId,
            input.canonicalMessageId,
          ),
          eq(
            conversationProviderSessionCheckpoints.provider,
            "claude_code",
          ),
          eq(conversations.origin, "native_live"),
        ),
      )
      .limit(1);

    return row
      ? {
          id: row.id,
          conversationId: row.conversationId,
          canonicalMessageId: row.canonicalMessageId,
          provider: row.provider,
          providerSessionId: row.providerSessionId,
          providerCheckpointId: row.providerCheckpointId,
          createdAt: row.createdAt.toISOString(),
        }
      : null;
  }

  private async requireNativeConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ id: string; currentHeadMessageId: string | null }> {
    const [row] = await this.db
      .select({
        id: conversations.id,
        currentHeadMessageId: conversations.currentHeadMessageId,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.id, conversationId),
          eq(conversations.origin, "native_live"),
        ),
      )
      .limit(1);

    if (!row) throw notFound();
    return row;
  }

  private async requireMessage(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<{
    id: string;
    role: string;
    status: string;
  }> {
    await this.requireNativeConversation(userId, conversationId);
    const [row] = await this.db
      .select({
        id: conversationMessages.id,
        role: conversationMessages.role,
        status: conversationMessages.status,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.userId, userId),
          eq(conversationMessages.conversationId, conversationId),
          eq(conversationMessages.id, messageId),
        ),
      )
      .limit(1);

    if (!row) throw notFound();
    return row;
  }
}
