import {
  and,
  asc,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import {
  conversationMessages,
  conversationContentBlocks,
  conversations,
  nativeLiveSemanticScoringRequests,
  nativeLiveTurnPreparations,
} from "../../../../database/schema.js";
import { DrizzleNativeLiveConversationRepository } from "../../../conversation/native-live-conversation-repository.js";
import type {
  NativeLiveMessage,
  NativeLiveProviderCheckpoint,
} from "../../../conversation/native-live-conversation-types.js";
import type { NativeLivePreparedTurn } from "../native-live-backend-turn-coordinator.js";
import { parseNativeLiveExecutionSelection } from "../native-live-execution-selection.js";
import type { NativeLiveRuntimeMetadata } from "../../protocol/native-live-runtime-protocol.js";
import type { TurnRepositoryContext } from "./types.js";
import { mapPreparation } from "./records.js";
import { readableContentData } from "../../../conversation/native-live-content-contract.js";
import type {
  NativeLiveBackendTurnReadModel,
  Executor,
  PreparationRow,
  Transaction,
} from "./types.js";

export async function getPreparation(
  this: TurnRepositoryContext,
  input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLivePreparedTurn | null> {
    const row = await this.findById(this.db, input.userId, input.prepareId);
    return row ? mapPreparation(row) : null;
  }

export async function readActiveTurn(
  this: TurnRepositoryContext,
  input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveBackendTurnReadModel | null> {
    const [active] = await this.db
      .select({ id: nativeLiveTurnPreparations.id })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(
            nativeLiveTurnPreparations.conversationId,
            input.conversationId,
          ),
          eq(nativeLiveTurnPreparations.status, "prepared"),
          inArray(nativeLiveTurnPreparations.dispatchStatus, [
            "staged",
            "pending",
            "reserved",
            "executing",
            "delivery_unknown",
          ]),
        ),
      )
      .orderBy(
        sql`${nativeLiveTurnPreparations.createdAt} DESC`,
        sql`${nativeLiveTurnPreparations.id} DESC`,
      )
      .limit(1);

    if (!active) return null;
    return this.readTurn({
      userId: input.userId,
      prepareId: active.id,
    });
  }

export async function readTurn(
  this: TurnRepositoryContext,
  input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLiveBackendTurnReadModel | null> {
    const [row] = await this.db
      .select({
        id: nativeLiveTurnPreparations.id,
        createdAt: nativeLiveTurnPreparations.createdAt,
        requestId: nativeLiveTurnPreparations.requestId,
        conversationId: nativeLiveTurnPreparations.conversationId,
        operation: nativeLiveTurnPreparations.operation,
        replacementTargetUserMessageId: nativeLiveTurnPreparations.replacementTargetUserMessageId,
        canonicalUserMessageId:
          nativeLiveTurnPreparations.canonicalUserMessageId,
        workspaceId: nativeLiveTurnPreparations.workspaceId,
        expectedWorkspaceRoot:
          nativeLiveTurnPreparations.expectedWorkspaceRoot,
        executionSelection:
          nativeLiveTurnPreparations.executionSelection,
        canonicalStatus: nativeLiveTurnPreparations.status,
        dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
        assistantMessageId: nativeLiveTurnPreparations.assistantMessageId,
        runtimeMetadata: nativeLiveTurnPreparations.runtimeMetadata,
        failureCode: nativeLiveTurnPreparations.failureCode,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.prepareId),
        ),
      )
      .limit(1);

    if (!row) return null;

    const [semantic] = await this.db
      .select({
        status: nativeLiveSemanticScoringRequests.status,
        fallbackCode: nativeLiveSemanticScoringRequests.fallbackCode,
      })
      .from(nativeLiveSemanticScoringRequests)
      .where(
        and(
          eq(nativeLiveSemanticScoringRequests.userId, input.userId),
          eq(nativeLiveSemanticScoringRequests.prepareId, input.prepareId),
        ),
      )
      .limit(1);

    // This is also the bounded-wait hot path. Read only this preparation's exact
    // detached user and optional finalized assistant, never the whole conversation.
    const messageIds = [row.canonicalUserMessageId, ...(row.assistantMessageId ? [row.assistantMessageId] : [])];
    const messageRows = await this.db.select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      parentMessageId: conversationMessages.parentMessageId,
      role: conversationMessages.role,
      status: conversationMessages.status,
      createdAt: conversationMessages.createdAt,
      completedAt: conversationMessages.completedAt,
    }).from(conversationMessages).innerJoin(conversations, and(
      eq(conversations.id, conversationMessages.conversationId),
      eq(conversations.userId, conversationMessages.userId),
    )).where(and(
      eq(conversationMessages.userId, input.userId),
      eq(conversationMessages.conversationId, row.conversationId),
      eq(conversations.origin, "native_live"),
      inArray(conversationMessages.id, messageIds),
    )).limit(2);
    const userRow = messageRows.find(message => message.id === row.canonicalUserMessageId && message.role === "user");
    const assistantRow = row.assistantMessageId
      ? messageRows.find(message => message.id === row.assistantMessageId && message.role === "assistant") : null;
    if (!userRow) throw new Error("Prepared user message was not found.");
    if (row.assistantMessageId && !assistantRow) throw new Error("Finalized assistant message was not found.");

    const blockRows = await this.db.select({
      id: conversationContentBlocks.id,
      messageId: conversationContentBlocks.messageId,
      ordinal: conversationContentBlocks.ordinal,
      kind: conversationContentBlocks.kind,
      rawType: conversationContentBlocks.rawType,
      text: conversationContentBlocks.text,
      payload: conversationContentBlocks.payload,
      createdAt: conversationContentBlocks.createdAt,
    }).from(conversationContentBlocks).where(and(
      eq(conversationContentBlocks.userId, input.userId),
      inArray(conversationContentBlocks.messageId, messageRows.map(message => message.id)),
    )).orderBy(asc(conversationContentBlocks.messageId), asc(conversationContentBlocks.ordinal));
    const blocksByMessage = new Map<string, NativeLiveMessage["blocks"]>();
    for (const block of blockRows) {
      const blocks = blocksByMessage.get(block.messageId) ?? [];
      blocks.push({
        id: block.id,
        ordinal: block.ordinal,
        ...readableContentData(block.kind, block.rawType, block.text, block.payload),
        rawType: block.rawType,
        createdAt: block.createdAt.toISOString(),
      });
      blocksByMessage.set(block.messageId, blocks);
    }
    const message = (value: typeof userRow): NativeLiveMessage => {
      if (value.role !== "user" && value.role !== "assistant") throw new Error("Unsupported turn message role.");
      return {
        id: value.id,
        conversationId: value.conversationId,
        parentMessageId: value.parentMessageId,
        role: value.role,
        status: value.status,
        createdAt: value.createdAt.toISOString(),
        completedAt: value.completedAt?.toISOString() ?? null,
        blocks: blocksByMessage.get(value.id) ?? [],
      };
    };
    const preparedUserMessage = message(userRow);
    const assistantMessage = assistantRow ? message(assistantRow) : null;

    return {
      prepareId: row.id,
      startedAt: row.createdAt.toISOString(),
      requestId: row.requestId,
      conversationId: row.conversationId,
      operation: row.operation,
      preparedUserMessage,
      replacementTargetUserMessageId: row.replacementTargetUserMessageId ?? (row.operation === "retry" ? row.canonicalUserMessageId : null),
      canonicalUserMessageId: row.canonicalUserMessageId,
      workspaceId: row.workspaceId,
      expectedWorkspaceRoot: row.expectedWorkspaceRoot,
      executionSelection:
        row.executionSelection === null
          ? null
          : parseNativeLiveExecutionSelection(
              row.executionSelection,
            ),
      canonicalStatus: row.canonicalStatus,
      dispatchStatus: row.dispatchStatus,
      assistantMessage,
      runtimeMetadata:
        row.runtimeMetadata as NativeLiveRuntimeMetadata | null,
      failureCode: row.failureCode,
      semanticStatus: semantic?.status ?? null,
      semanticFallbackCode: semantic?.fallbackCode ?? null,
    };
  }

export async function findByRequest(
  this: TurnRepositoryContext,
    executor: Executor,
    userId: string,
    requestId: string,
  ): Promise<PreparationRow | null> {
    const [row] = await executor
      .select(this.selection())
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, userId),
          eq(nativeLiveTurnPreparations.requestId, requestId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

export async function findById(
  this: TurnRepositoryContext,
    executor: Executor,
    userId: string,
    prepareId: string,
    lock = false,
  ): Promise<PreparationRow | null> {
    const query = executor
      .select(this.selection())
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, userId),
          eq(nativeLiveTurnPreparations.id, prepareId),
        ),
      );

    const rows = lock
      ? await query.for("update").limit(1)
      : await query.limit(1);
    return rows[0] ?? null;
  }

export async function loadFinalizedSuccess(
  this: TurnRepositoryContext,
    transaction: Transaction,
    row: PreparationRow,
  ): Promise<{
    assistantMessage: NativeLiveMessage;
    checkpoint: NativeLiveProviderCheckpoint;
  }> {
    if (!row.assistantMessageId) {
      throw new Error("Finalized preparation is missing its assistant message.");
    }

    const conversations =
      new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );
    const conversation = await conversations.getConversation({
      userId: row.userId,
      conversationId: row.conversationId,
    });
    const assistantMessage = conversation?.messages.find(
      (message) => message.id === row.assistantMessageId,
    );
    if (!assistantMessage) {
      throw new Error("Finalized assistant message was not found.");
    }

    const checkpoint = await conversations.getProviderCheckpointForHead({
      userId: row.userId,
      conversationId: row.conversationId,
      canonicalMessageId: row.assistantMessageId,
    });
    if (!checkpoint) {
      throw new Error("Finalized provider checkpoint was not found.");
    }

    return { assistantMessage, checkpoint };
  }

export function selection(this: TurnRepositoryContext) {
    return {
      id: nativeLiveTurnPreparations.id,
      createdAt: nativeLiveTurnPreparations.createdAt,
      userId: nativeLiveTurnPreparations.userId,
      requestId: nativeLiveTurnPreparations.requestId,
      conversationId: nativeLiveTurnPreparations.conversationId,
      operation: nativeLiveTurnPreparations.operation,
      requestHash: nativeLiveTurnPreparations.requestHash,
      canonicalUserMessageId:
        nativeLiveTurnPreparations.canonicalUserMessageId,
      replacementTargetUserMessageId:
        nativeLiveTurnPreparations.replacementTargetUserMessageId,
      runtimeMode: nativeLiveTurnPreparations.runtimeMode,
      parentProviderSessionId:
        nativeLiveTurnPreparations.parentProviderSessionId,
      workspaceId: nativeLiveTurnPreparations.workspaceId,
      expectedWorkspaceRoot:
        nativeLiveTurnPreparations.expectedWorkspaceRoot,
      executionSelection: nativeLiveTurnPreparations.executionSelection,
      attachments: nativeLiveTurnPreparations.attachments,
      prompt: nativeLiveTurnPreparations.prompt,
      mindPrepared: nativeLiveTurnPreparations.mindPrepared,
      status: nativeLiveTurnPreparations.status,
      resultHash: nativeLiveTurnPreparations.resultHash,
      providerSessionId: nativeLiveTurnPreparations.providerSessionId,
      runtimeMetadata: nativeLiveTurnPreparations.runtimeMetadata,
      assistantMessageId: nativeLiveTurnPreparations.assistantMessageId,
      failureCode: nativeLiveTurnPreparations.failureCode,
    };
  }
