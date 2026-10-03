import { readableContentData, storedContentKind, storedContentPayload } from './native-live-content-contract.js';
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  conversationContentBlocks,
  conversationFavorites,
  conversationMessages,
  conversationProviderSessionCheckpoints,
  conversations,
  nativeLiveBackgroundModelJobs,
  nativeLiveTurnPreparations,
  runtimeDistillationWatermarks,
  runtimeDriveSatisfactionEvents,
  runtimeEffects,
  runtimeMindSemanticGroupingRequests,
  runtimeProactivityWakes,
  runtimeSubjectStates,
  runtimeSubjectStateTransitions,
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
import {
  workflowReferencesAnyId,
} from "../bridge/turn/native-live-replacement-purge.js";
import {
  structuredValueReferencesAnyId,
} from "../runtime/lifecycle/persistent-reference-scan.js";

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

export type NativeLiveConversationListPage = {
  conversations: NativeLiveConversationSummary[];
  nextCursor: string | null;
};

export type NativeLiveConversationListScope = "active" | "archived";

export type NativeLiveConversationArchiveResult =
  | {
      outcome: "archived" | "already_archived";
      archivedAt: string;
    }
  | { outcome: "busy" }
  | { outcome: "not_found" };

export type NativeLiveConversationRestoreResult =
  | { outcome: "restored" | "already_active" }
  | { outcome: "not_found" };

export type NativeLiveConversationDeleteResult =
  | { outcome: "deleted" }
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
    scope?: NativeLiveConversationListScope;
  }): Promise<NativeLiveConversationSummary[]>;

  listConversationPage?(input: {
    userId: string;
    limit: number;
    cursor?: string | null;
    scope?: NativeLiveConversationListScope;
  }): Promise<NativeLiveConversationListPage>;

  getConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversation | null>;

  renameConversation(input: {
    userId: string;
    conversationId: string;
    title: string;
  }): Promise<NativeLiveConversationSummary | null>;

  archiveConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationArchiveResult>;

  restoreConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationRestoreResult>;

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
    scope?: NativeLiveConversationListScope;
  }): Promise<NativeLiveConversationSummary[]> {
    return (
      await this.listConversationPage({
        ...input,
        cursor: null,
      })
    ).conversations;
  }

  async listConversationPage(input: {
    userId: string;
    limit: number;
    cursor?: string | null;
    scope?: NativeLiveConversationListScope;
  }): Promise<NativeLiveConversationListPage> {
    const cursor = input.cursor
      ? parseNativeLiveConversationListCursor(input.cursor)
      : null;
    const lifecycleStatus = input.scope ?? "active";
    const conditions = [
      eq(conversations.userId, input.userId),
      eq(conversations.origin, "native_live"),
      eq(conversations.lifecycleStatus, lifecycleStatus),
    ];
    if (cursor) {
      const updatedAt = new Date(cursor.updatedAt);
      const cursorCondition = or(
        lt(conversations.updatedAt, updatedAt),
        and(
          eq(conversations.updatedAt, updatedAt),
          lt(conversations.id, cursor.id),
        ),
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }

    const rows = await this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        currentHeadMessageId: conversations.currentHeadMessageId,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const headIds = pageRows
      .map((row) => row.currentHeadMessageId)
      .filter((value): value is string => value !== null);
    const headRows = headIds.length === 0
      ? []
      : await this.db
          .select({
            id: conversationMessages.id,
            createdAt: conversationMessages.createdAt,
          })
          .from(conversationMessages)
          .where(and(
            eq(conversationMessages.userId, input.userId),
            inArray(conversationMessages.id, headIds),
          ));
    const headCreatedAtById = new Map(
      headRows.map((row) => [row.id, row.createdAt] as const),
    );
    const mapped = pageRows.map((row) => ({
      id: row.id,
      title: row.title,
      currentHeadMessageId: row.currentHeadMessageId,
      lastMessageAt:
        row.currentHeadMessageId
          ? headCreatedAtById.get(row.currentHeadMessageId)?.toISOString()
            ?? null
          : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
    const last = pageRows[pageRows.length - 1];

    return {
      conversations: mapped,
      nextCursor:
        hasMore && last
          ? encodeNativeLiveConversationListCursor({
              updatedAt: last.updatedAt.toISOString(),
              id: last.id,
            })
          : null,
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
      const blocks = blocksByMessage.get(row.messageId) ?? [];
      blocks.push({
        id: row.id,
        ordinal: row.ordinal,
        ...readableContentData(row.kind, row.rawType, row.text, row.payload),
        rawType: row.rawType,
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

    if (!row) return null;
    const [head] = row.currentHeadMessageId
      ? await this.db
          .select({ createdAt: conversationMessages.createdAt })
          .from(conversationMessages)
          .where(and(
            eq(conversationMessages.userId, input.userId),
            eq(conversationMessages.id, row.currentHeadMessageId),
          ))
          .limit(1)
      : [];
    return {
      id: row.id,
      title: row.title,
      currentHeadMessageId: row.currentHeadMessageId,
      lastMessageAt: head?.createdAt.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async archiveConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationArchiveResult> {
    return this.db.transaction(
      async (transaction) => {
        const [conversation] = await transaction
          .select({
            id: conversations.id,
            lifecycleStatus: conversations.lifecycleStatus,
            archivedAt: conversations.archivedAt,
          })
          .from(conversations)
          .where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
            eq(conversations.origin, "native_live"),
          ))
          .for("update")
          .limit(1);

        if (!conversation) return { outcome: "not_found" as const };
        if (conversation.lifecycleStatus === "archived") {
          if (!conversation.archivedAt) {
            throw new Error(
              "Archived native live conversation is missing archived_at.",
            );
          }
          return {
            outcome: "already_archived" as const,
            archivedAt: conversation.archivedAt.toISOString(),
          };
        }
        if (conversation.lifecycleStatus !== "active") {
          return { outcome: "not_found" as const };
        }

        const activeTurns = await transaction
          .select({ id: nativeLiveTurnPreparations.id })
          .from(nativeLiveTurnPreparations)
          .where(and(
            eq(nativeLiveTurnPreparations.userId, input.userId),
            eq(
              nativeLiveTurnPreparations.conversationId,
              input.conversationId,
            ),
            inArray(nativeLiveTurnPreparations.dispatchStatus, [
              "staged",
              "pending",
              "reserved",
              "executing",
              "delivery_unknown",
            ]),
          ))
          .limit(1);
        if (activeTurns.length > 0) return { outcome: "busy" as const };

        const archivedAt = new Date();
        const updated = await transaction
          .update(conversations)
          .set({
            lifecycleStatus: "archived",
            archivedAt,
            deletedAt: null,
            updatedAt: archivedAt,
          })
          .where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
            eq(conversations.origin, "native_live"),
            eq(conversations.lifecycleStatus, "active"),
          ))
          .returning({ id: conversations.id });
        if (updated.length !== 1) {
          throw new Error(
            "Native live conversation archive lost its lifecycle lock.",
          );
        }
        return {
          outcome: "archived" as const,
          archivedAt: archivedAt.toISOString(),
        };
      },
      { isolationLevel: "serializable" },
    );
  }

  async restoreConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationRestoreResult> {
    return this.db.transaction(
      async (transaction) => {
        const [conversation] = await transaction
          .select({
            id: conversations.id,
            lifecycleStatus: conversations.lifecycleStatus,
          })
          .from(conversations)
          .where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
            eq(conversations.origin, "native_live"),
          ))
          .for("update")
          .limit(1);

        if (!conversation) return { outcome: "not_found" as const };
        if (conversation.lifecycleStatus === "active") {
          return { outcome: "already_active" as const };
        }
        if (conversation.lifecycleStatus !== "archived") {
          return { outcome: "not_found" as const };
        }

        const updatedAt = new Date();
        const updated = await transaction
          .update(conversations)
          .set({
            lifecycleStatus: "active",
            archivedAt: null,
            deletedAt: null,
            updatedAt,
          })
          .where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
            eq(conversations.origin, "native_live"),
            eq(conversations.lifecycleStatus, "archived"),
          ))
          .returning({ id: conversations.id });
        if (updated.length !== 1) {
          throw new Error(
            "Native live conversation restore lost its lifecycle lock.",
          );
        }
        return { outcome: "restored" as const };
      },
      { isolationLevel: "serializable" },
    );
  }

  async deleteConversation(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveConversationDeleteResult> {
    return this.db.transaction(
      async (transaction) => {
        const [conversation] = await transaction
          .select({
            id: conversations.id,
            lifecycleStatus: conversations.lifecycleStatus,
          })
          .from(conversations)
          .where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
            eq(conversations.origin, "native_live"),
          ))
          .for("update")
          .limit(1);
        if (!conversation) return { outcome: "not_found" as const };

        const activeTurns = await transaction
          .select({ id: nativeLiveTurnPreparations.id })
          .from(nativeLiveTurnPreparations)
          .where(and(
            eq(nativeLiveTurnPreparations.userId, input.userId),
            eq(
              nativeLiveTurnPreparations.conversationId,
              input.conversationId,
            ),
            inArray(nativeLiveTurnPreparations.dispatchStatus, [
              "staged",
              "pending",
              "reserved",
              "executing",
            ]),
          ))
          .limit(1);
        if (activeTurns.length > 0) return { outcome: "busy" as const };

        const messages = await transaction
          .select({ id: conversationMessages.id })
          .from(conversationMessages)
          .where(and(
            eq(conversationMessages.userId, input.userId),
            eq(conversationMessages.conversationId, input.conversationId),
          ));
        const purgeMessageIds = new Set(
          messages.map((message) => message.id),
        );

        await transaction.execute(sql`
          INSERT INTO native_live_provider_session_cleanups (
            user_id, provider, provider_session_id
          )
          SELECT DISTINCT
            checkpoint.user_id,
            checkpoint.provider,
            checkpoint.provider_session_id
          FROM conversation_provider_session_checkpoints AS checkpoint
          WHERE checkpoint.user_id = ${input.userId}::uuid
            AND checkpoint.conversation_id = ${input.conversationId}::uuid
            AND NOT EXISTS (
              SELECT 1
              FROM conversation_provider_session_checkpoints AS surviving
              WHERE surviving.user_id = checkpoint.user_id
                AND surviving.provider = checkpoint.provider
                AND surviving.provider_session_id =
                  checkpoint.provider_session_id
                AND surviving.conversation_id <>
                  checkpoint.conversation_id
            )
          ON CONFLICT (user_id, provider, provider_session_id)
          DO NOTHING
        `);

        const wakes = await transaction
          .select({
            id: runtimeProactivityWakes.id,
            gate: runtimeProactivityWakes.gate,
            contactTarget: runtimeProactivityWakes.contactTarget,
            contextSnapshot: runtimeProactivityWakes.contextSnapshot,
            decision: runtimeProactivityWakes.decision,
          })
          .from(runtimeProactivityWakes)
          .where(eq(runtimeProactivityWakes.userId, input.userId))
          .for("update");
        const target = "conversation:" + input.conversationId;
        const workflowRootIds = new Set<string>([
          input.conversationId,
          ...purgeMessageIds,
        ]);
        const purgeWakeIds = wakes
          .filter((wake) =>
            wake.contactTarget === target
            || structuredValueReferencesAnyId(wake.gate, workflowRootIds)
            || structuredValueReferencesAnyId(
              wake.contextSnapshot,
              workflowRootIds,
            )
            || structuredValueReferencesAnyId(
              wake.decision,
              workflowRootIds,
            )
          )
          .map((wake) => wake.id);
        const workflowCausalIds = new Set<string>([
          input.conversationId,
          ...purgeMessageIds,
          ...purgeWakeIds,
        ]);

        const backgroundJobs = await transaction
          .select({
            id: nativeLiveBackgroundModelJobs.id,
            workflowKind: nativeLiveBackgroundModelJobs.workflowKind,
            workflowRunId: nativeLiveBackgroundModelJobs.workflowRunId,
            workflowPayload: nativeLiveBackgroundModelJobs.workflowPayload,
          })
          .from(nativeLiveBackgroundModelJobs)
          .where(eq(nativeLiveBackgroundModelJobs.userId, input.userId));
        const purgeBackgroundJobIds = backgroundJobs
          .filter((job) =>
            (
              job.workflowKind === "distillation"
              && job.workflowPayload?.conversation_id
                === input.conversationId
            )
            || (
              job.workflowRunId !== null
              && purgeWakeIds.includes(job.workflowRunId)
            )
            || workflowReferencesAnyId(
              job.workflowPayload,
              workflowCausalIds,
            )
          )
          .map((job) => job.id);

        if (purgeBackgroundJobIds.length > 0) {
          await transaction
            .delete(nativeLiveBackgroundModelJobs)
            .where(and(
              eq(nativeLiveBackgroundModelJobs.userId, input.userId),
              inArray(
                nativeLiveBackgroundModelJobs.id,
                purgeBackgroundJobIds,
              ),
            ));
        }

        if (purgeWakeIds.length > 0) {
          await transaction
            .delete(runtimeEffects)
            .where(and(
              eq(runtimeEffects.userId, input.userId),
              inArray(runtimeEffects.sourceWakeId, purgeWakeIds),
            ));
        }
        await transaction
          .delete(runtimeEffects)
          .where(and(
            eq(runtimeEffects.userId, input.userId),
            eq(runtimeEffects.target, target),
          ));
        if (purgeWakeIds.length > 0) {
          await transaction
            .delete(runtimeProactivityWakes)
            .where(and(
              eq(runtimeProactivityWakes.userId, input.userId),
              inArray(runtimeProactivityWakes.id, purgeWakeIds),
            ));
        }

        await transaction
          .delete(runtimeDistillationWatermarks)
          .where(and(
            eq(runtimeDistillationWatermarks.userId, input.userId),
            eq(
              runtimeDistillationWatermarks.conversationId,
              input.conversationId,
            ),
          ));

        await transaction
          .delete(conversationFavorites)
          .where(and(
            eq(conversationFavorites.userId, input.userId),
            eq(
              conversationFavorites.conversationId,
              input.conversationId,
            ),
          ));

        const deleted = await transaction
          .delete(conversations)
          .where(and(
            eq(conversations.userId, input.userId),
            eq(conversations.id, input.conversationId),
            eq(conversations.origin, "native_live"),
          ))
          .returning({ id: conversations.id });
        if (deleted.length !== 1) {
          throw new Error(
            "Native live conversation delete lost its lifecycle lock.",
          );
        }
        return { outcome: "deleted" as const };
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
        kind: storedContentKind(input.block.kind),
        rawType: input.block.rawType ?? input.block.kind,
        text: input.block.text ?? null,
        payload: storedContentPayload(input.block.kind, input.block.payload ?? null),
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

    return {
      id: row.id,
      ordinal: row.ordinal,
      ...readableContentData(row.kind, row.rawType, row.text, row.payload),
      rawType: row.rawType,
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
        workspaceId: input.checkpoint.workspaceId ?? null,
        effectiveWorkspaceRoot:
          input.checkpoint.effectiveWorkspaceRoot ?? null,
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
      workspaceId: row.workspaceId,
      effectiveWorkspaceRoot: row.effectiveWorkspaceRoot,
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
        workspaceId:
          conversationProviderSessionCheckpoints.workspaceId,
        effectiveWorkspaceRoot:
          conversationProviderSessionCheckpoints.effectiveWorkspaceRoot,
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
          workspaceId: row.workspaceId,
          effectiveWorkspaceRoot: row.effectiveWorkspaceRoot,
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

const NATIVE_LIVE_CONVERSATION_CURSOR_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function encodeNativeLiveConversationListCursor(input: {
  updatedAt: string;
  id: string;
}): string {
  const timestamp = new Date(input.updatedAt);
  if (
    !Number.isFinite(timestamp.getTime())
    || !NATIVE_LIVE_CONVERSATION_CURSOR_UUID_PATTERN.test(input.id)
  ) {
    throw new RangeError("Native live conversation cursor is invalid.");
  }
  return Buffer.from(
    JSON.stringify([timestamp.toISOString(), input.id]),
    "utf8",
  ).toString("base64url");
}

export function parseNativeLiveConversationListCursor(
  value: string,
): { updatedAt: string; id: string } {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      !Array.isArray(decoded)
      || decoded.length !== 2
      || typeof decoded[0] !== "string"
      || typeof decoded[1] !== "string"
      || !NATIVE_LIVE_CONVERSATION_CURSOR_UUID_PATTERN.test(decoded[1])
    ) {
      throw new Error("invalid");
    }
    const timestamp = new Date(decoded[0]);
    if (!Number.isFinite(timestamp.getTime())) {
      throw new Error("invalid");
    }
    return {
      updatedAt: timestamp.toISOString(),
      id: decoded[1],
    };
  } catch {
    throw new RangeError("Native live conversation cursor is invalid.");
  }
}
