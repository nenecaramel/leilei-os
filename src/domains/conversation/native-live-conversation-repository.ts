import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationContentBlocks,
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
  nativeLiveTurnPreparations,
} from "../../database/schema.js";
import type {
  NativeLiveContentBlock,
  NativeLiveContentBlockInput,
  NativeLiveConversation,
  NativeLiveConversationSummary,
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

export type NativeLiveConversationDeleteResult =
  | {
      outcome: "deleted" | "already_deleted";
      deletedAt: string;
    }
  | { outcome: "busy" }
  | { outcome: "not_found" };

export interface NativeLiveConversationRepository {
  withTransaction<T>(
    work: (repository: NativeLiveConversationRepository) => Promise<T>,
  ): Promise<T>;

  createConversation(input: {
    userId: string;
    title?: string | null;
  }): Promise<NativeLiveConversation>;

  listConversations?(input: {
    userId: string;
    limit: number;
  }): Promise<NativeLiveConversationSummary[]>;

  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null>;

  renameConversation(input: {
    userId: string;
    conversationId: string;
    title: string;
  }): Promise<NativeLiveConversationSummary | null>;

  deleteConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationDeleteResult>;

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
  }): Promise<NativeLiveContentBlock>;

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

  async listConversations(input: {
    userId: string;
    limit: number;
  }): Promise<NativeLiveConversationSummary[]> {
    const rows = await this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        currentHeadMessageId: conversations.currentHeadMessageId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, input.userId),
          eq(conversations.origin, "native_live"),
          eq(conversations.lifecycleStatus, "active"),
        ),
      )
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(input.limit);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      currentHeadMessageId: row.currentHeadMessageId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
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

  async renameConversation(input: {
    userId: string;
    conversationId: string;
    title: string;
  }): Promise<NativeLiveConversationSummary | null> {
    const title = input.title.trim();
    if (!title || title.length > 200) {
      throw new Error(
        "Native live conversation title must be 1-200 characters.",
      );
    }

    const updatedAt = new Date();
    const [row] = await this.db
      .update(conversations)
      .set({
        title,
        updatedAt,
      })
      .where(
        and(
          eq(conversations.userId, input.userId),
          eq(conversations.id, input.conversationId),
          eq(conversations.origin, "native_live"),
          eq(conversations.lifecycleStatus, "active"),
        ),
      )
      .returning({
        id: conversations.id,
        title: conversations.title,
        currentHeadMessageId: conversations.currentHeadMessageId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      });

    return row
      ? {
          id: row.id,
          title: row.title,
          currentHeadMessageId: row.currentHeadMessageId,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }
      : null;
  }

  async deleteConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationDeleteResult> {
    return this.db.transaction(
      async (transaction) => {
        const rows = await transaction
          .select({
            id: conversations.id,
            lifecycleStatus: conversations.lifecycleStatus,
            deletedAt: conversations.deletedAt,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.userId, input.userId),
              eq(conversations.id, input.conversationId),
              eq(conversations.origin, "native_live"),
            ),
          )
          .for("update")
          .limit(1);

        const conversation = rows[0];
        if (!conversation) return { outcome: "not_found" as const };

        if (conversation.lifecycleStatus === "deleted") {
          if (!conversation.deletedAt) {
            throw new Error(
              "Deleted native live conversation is missing deleted_at.",
            );
          }
          return {
            outcome: "already_deleted" as const,
            deletedAt: conversation.deletedAt.toISOString(),
          };
        }

        if (conversation.lifecycleStatus !== "active") {
          return { outcome: "not_found" as const };
        }

        const activeTurns = await transaction
          .select({ id: nativeLiveTurnPreparations.id })
          .from(nativeLiveTurnPreparations)
          .where(
            and(
              eq(nativeLiveTurnPreparations.userId, input.userId),
              eq(
                nativeLiveTurnPreparations.conversationId,
                input.conversationId,
              ),
              inArray(
                nativeLiveTurnPreparations.dispatchStatus,
                [
                  "staged",
                  "pending",
                  "reserved",
                  "executing",
                  "delivery_unknown",
                ],
              ),
            ),
          )
          .limit(1);

        if (activeTurns.length > 0) {
          return { outcome: "busy" as const };
        }

        const deletedAt = new Date();
        const updated = await transaction
          .update(conversations)
          .set({
            lifecycleStatus: "deleted",
            archivedAt: null,
            deletedAt,
            updatedAt: deletedAt,
          })
          .where(
            and(
              eq(conversations.userId, input.userId),
              eq(conversations.id, input.conversationId),
              eq(conversations.origin, "native_live"),
              eq(conversations.lifecycleStatus, "active"),
            ),
          )
          .returning({ id: conversations.id });

        if (updated.length !== 1) {
          throw new Error(
            "Native live conversation delete lost its lifecycle lock.",
          );
        }

        return {
          outcome: "deleted" as const,
          deletedAt: deletedAt.toISOString(),
        };
      },
      { isolationLevel: "serializable" },
    );
  }

  async appendUserMessage(input: {
    userId: string;
    conversationId: string;
    parentMessageId: string | null;
  }): Promise<NativeLiveMessage> {
    await this.requireNativeConversation(input.userId, input.conversationId);
    if (input.parentMessageId) {
      const parent = await this.requireMessage(
        input.userId,
        input.conversationId,
        input.parentMessageId,
      );
      if (parent.role !== "assistant" || parent.status !== "completed") {
        throw notFound();
      }
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
  }): Promise<NativeLiveContentBlock> {
    await this.requireMessage(
      input.userId,
      input.conversationId,
      input.messageId,
    );

    const [row] = await this.db
      .insert(conversationContentBlocks)
      .values({
        userId: input.userId,
        messageId: input.messageId,
        ordinal: input.ordinal,
        kind: input.block.kind,
        rawType: input.block.rawType ?? input.block.kind,
        text: input.block.text ?? null,
        payload: input.block.payload ?? null,
      })
      .returning({
        id: conversationContentBlocks.id,
        ordinal: conversationContentBlocks.ordinal,
        kind: conversationContentBlocks.kind,
        rawType: conversationContentBlocks.rawType,
        text: conversationContentBlocks.text,
        payload: conversationContentBlocks.payload,
        createdAt: conversationContentBlocks.createdAt,
      });

    if (!row) throw new Error("Native live content block insert failed.");
    if (
      row.kind !== "text" &&
      row.kind !== "tool_use" &&
      row.kind !== "tool_result" &&
      row.kind !== "attachment"
    ) {
      throw new Error("Native live content block has an unsupported kind.");
    }

    return {
      id: row.id,
      ordinal: row.ordinal,
      kind: row.kind,
      rawType: row.rawType,
      text: row.text,
      payload: row.payload,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async setCurrentHead(input: {
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<void> {
    const head = await this.requireMessage(
      input.userId,
      input.conversationId,
      input.messageId,
    );
    if (head.role !== "assistant" || head.status !== "completed") {
      throw notFound();
    }

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
        runtimeMetadata: input.checkpoint.runtimeMetadata ?? null,
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
      runtimeMetadata: row.runtimeMetadata,
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
        runtimeMetadata:
          conversationProviderSessionCheckpoints.runtimeMetadata,
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
          runtimeMetadata: row.runtimeMetadata,
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
          eq(conversations.lifecycleStatus, "active"),
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
