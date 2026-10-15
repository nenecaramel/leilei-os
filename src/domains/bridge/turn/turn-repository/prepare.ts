import { nativeContinuationBinding } from "../../../conversation/native-session-continuation-repository.js";
import { readNativeResumeCheckpoint } from "../native-live-resume-checkpoint.js";
import {
  and,
  eq,
  sql,
} from "drizzle-orm";
import {
  nativeLiveTurnPreparations,
  conversations,
} from "../../../../database/schema.js";
import { DrizzleNativeLiveConversationRepository, nativeSessionHeldByDesktop } from "../../../conversation/native-live-conversation-repository.js";
import type {
  NativeLivePreparedTurn,
  NativeLivePreparePortResult,
} from "../native-live-backend-turn-coordinator.js";
import type { NativeLiveExecutionSelection } from "../native-live-execution-selection.js";
import type { NativeLiveRuntimeMode } from "../../protocol/native-live-runtime-protocol.js";
import {
  DrizzleNativeLiveAttachmentBinding,
  type NativeLiveRuntimeAttachment,
} from "../../attachment/native-live-attachment-service.js";
import { planReplacementMessagePurge } from "../native-live-replacement-purge.js";
import type { TurnRepositoryContext } from "./types.js";
import {
  hashJson,
  REQUEST_HASH_VERSION,
  requestConflictOrReplay,
  readUserText,
  mapPreparation,
} from "./records.js";
import type {
  Transaction,
  Executor,
} from "./types.js";

export async function prepareSend(
  this: TurnRepositoryContext,
  input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    expectedHeadMessageId: string | null;
    text: string;
    inputMode?: "voice";
    interactionMode?: "live_call";
    attachmentIds: readonly string[];
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult> {
    const requestHash = hashJson(REQUEST_HASH_VERSION, {
      operation: "send",
      conversationId: input.conversationId,
      expectedHeadMessageId: input.expectedHeadMessageId,
      text: input.text,
      ...(input.inputMode === "voice" ? { inputMode: "voice" } : {}),
      ...(input.interactionMode === "live_call" ? { interactionMode: "live_call" } : {}),
      ...(input.attachmentIds.length > 0
        ? { attachmentIds: input.attachmentIds }
        : {}),
      ...(input.executionSelection
        ? { executionSelection: input.executionSelection }
        : {}),
    });

    return this.prepareWithRaceRecovery(
      input.userId,
      input.requestId,
      requestHash,
      async (transaction) => {
        const existing = await this.findByRequest(
          transaction as Transaction,
          input.userId,
          input.requestId,
        );
        if (existing) return requestConflictOrReplay(existing, requestHash);

        if (await nativeSessionHeldByDesktop(transaction as Transaction, input)) return { ok: false as const, code: "SESSION_OWNED_BY_DESKTOP" as const };

        const conversations =
          new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );
        const conversation = await conversations.getConversation({
          userId: input.userId,
          conversationId: input.conversationId,
        });
        if (
          !conversation
          || conversation.lifecycleStatus !== "active"
        ) {
          return { ok: false as const, code: "CONVERSATION_NOT_FOUND" as const };
        }
        if (
          conversation.currentHeadMessageId
          !== input.expectedHeadMessageId
        ) {
          return {
            ok: false as const,
            code: "STALE_HEAD" as const,
            currentHeadMessageId: conversation.currentHeadMessageId,
          };
        }

        const runtimeParent = await this.resolveRuntimeParent(
          transaction as Transaction,
          conversations,
          input.userId,
          input.conversationId,
          conversation.currentHeadMessageId,
          "send",
        );
        if (!runtimeParent.ok) return runtimeParent.result;

        const userMessage = await conversations.appendUserMessage({
          userId: input.userId,
          conversationId: input.conversationId,
          parentMessageId: conversation.currentHeadMessageId,
        });
        if (input.text.length > 0) {
          await conversations.appendContentBlock({
            userId: input.userId,
            conversationId: input.conversationId,
            messageId: userMessage.id,
            ordinal: 0,
            block: {
              kind: "text",
              rawType: "text",
              text: input.text,
              ...(input.inputMode === "voice"
                ? { payload: { input_mode: "voice",
                    ...(input.interactionMode === "live_call" ? { interaction_mode: "live_call" } : {}) } }
                : {}),
            },
          });
        }
        const attachmentBinding =
          new DrizzleNativeLiveAttachmentBinding(
            transaction as Transaction,
          );
        const attachments =
          await attachmentBinding.bindReadyToMessage({
            userId: input.userId,
            messageId: userMessage.id,
            attachmentIds: input.attachmentIds,
            startOrdinal:
              input.text.length > 0 ? 1 : 0,
          });

        const preparation = await this.insertPreparation(transaction, {
          prepareId: input.prepareId,
          userId: input.userId,
          requestId: input.requestId,
          conversationId: input.conversationId,
          operation: "send",
          requestHash,
          canonicalUserMessageId: userMessage.id,
          replacementTargetUserMessageId: null,
          runtimeMode: runtimeParent.runtimeMode,
          parentProviderSessionId: runtimeParent.parentProviderSessionId,
          expectedWorkingDirectory: runtimeParent.expectedWorkingDirectory,
          parentProviderCheckpointId: runtimeParent.parentProviderCheckpointId ?? null,
          executionSelection: input.executionSelection,
          attachments,
          prompt:
            input.text.length > 0
              ? input.text
              : "The user sent the attached file(s).",
        });

        return {
          ok: true as const,
          outcome: "created" as const,
          preparation,
        };
      },
    );
  }

export async function prepareRetry(
  this: TurnRepositoryContext,
  input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    targetUserMessageId: string;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult> {
    const requestHash = hashJson(REQUEST_HASH_VERSION, {
      operation: "retry",
      conversationId: input.conversationId,
      targetUserMessageId: input.targetUserMessageId,
      ...(input.executionSelection
        ? { executionSelection: input.executionSelection }
        : {}),
    });

    return this.prepareWithRaceRecovery(
      input.userId,
      input.requestId,
      requestHash,
      async (transaction) => {
        const existing = await this.findByRequest(
          transaction as Transaction,
          input.userId,
          input.requestId,
        );
        if (existing) return requestConflictOrReplay(existing, requestHash);

        if (await nativeSessionHeldByDesktop(transaction as Transaction, input)) return { ok: false as const, code: "SESSION_OWNED_BY_DESKTOP" as const };

        const conversations =
          new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );
        const conversation = await conversations.getConversation({
          userId: input.userId,
          conversationId: input.conversationId,
        });
        if (
          !conversation
          || conversation.lifecycleStatus !== "active"
        ) {
          return { ok: false as const, code: "CONVERSATION_NOT_FOUND" as const };
        }

        const target = conversation.messages.find(
          (message) =>
            message.id === input.targetUserMessageId
            && message.role === "user",
        );
        const attachmentBinding =
          new DrizzleNativeLiveAttachmentBinding(
            transaction as Transaction,
          );
        const attachments = target
          ? await attachmentBinding.readForMessage({
              userId: input.userId,
              messageId: target.id,
            })
          : [];
        const prompt = target
          ? (
              readUserText(target)
              ?? (
                attachments.length > 0
                  ? "The user sent the attached file(s)."
                  : null
              )
            )
          : null;
        const purgePlan = target
          ? planReplacementMessagePurge({
              operation: "retry",
              conversation,
              targetUserMessageId: target.id,
            })
          : null;
        if (!target || !prompt || !purgePlan) {
          return { ok: false as const, code: "BRANCH_POINT_INVALID" as const };
        }

        const runtimeParent = await this.resolveRuntimeParent(
          transaction as Transaction,
          conversations,
          input.userId,
          input.conversationId,
          target.parentMessageId,
        );
        if (!runtimeParent.ok) return runtimeParent.result;

        const preparation = await this.insertPreparation(transaction, {
          prepareId: input.prepareId,
          userId: input.userId,
          requestId: input.requestId,
          conversationId: input.conversationId,
          operation: "retry",
          requestHash,
          canonicalUserMessageId: target.id,
          replacementTargetUserMessageId: target.id,
          runtimeMode: runtimeParent.runtimeMode,
          parentProviderSessionId: runtimeParent.parentProviderSessionId,
          expectedWorkingDirectory: runtimeParent.expectedWorkingDirectory,
          parentProviderCheckpointId: runtimeParent.parentProviderCheckpointId ?? null,
          executionSelection: input.executionSelection,
          attachments,
          prompt,
        });

        return {
          ok: true as const,
          outcome: "created" as const,
          preparation,
        };
      },
    );
  }

export async function prepareEdit(
  this: TurnRepositoryContext,
  input: {
    prepareId: string;
    userId: string;
    requestId: string;
    conversationId: string;
    targetUserMessageId: string;
    text: string;
    attachmentIds: readonly string[] | null;
    executionSelection: NativeLiveExecutionSelection | null;
  }): Promise<NativeLivePreparePortResult> {
    const requestHash = hashJson(REQUEST_HASH_VERSION, {
      operation: "edit",
      conversationId: input.conversationId,
      targetUserMessageId: input.targetUserMessageId,
      text: input.text,
      ...(input.attachmentIds !== null
        ? { attachmentIds: input.attachmentIds }
        : {}),
      ...(input.executionSelection
        ? { executionSelection: input.executionSelection }
        : {}),
    });

    return this.prepareWithRaceRecovery(
      input.userId,
      input.requestId,
      requestHash,
      async (transaction) => {
        const existing = await this.findByRequest(
          transaction as Transaction,
          input.userId,
          input.requestId,
        );
        if (existing) return requestConflictOrReplay(existing, requestHash);

        if (await nativeSessionHeldByDesktop(transaction as Transaction, input)) return { ok: false as const, code: "SESSION_OWNED_BY_DESKTOP" as const };

        const conversations =
          new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );
        const conversation = await conversations.getConversation({
          userId: input.userId,
          conversationId: input.conversationId,
        });
        if (
          !conversation
          || conversation.lifecycleStatus !== "active"
        ) {
          return { ok: false as const, code: "CONVERSATION_NOT_FOUND" as const };
        }

        const target = conversation.messages.find(
          (message) =>
            message.id === input.targetUserMessageId
            && message.role === "user",
        );
        const purgePlan = target
          ? planReplacementMessagePurge({
              operation: "edit",
              conversation,
              targetUserMessageId: target.id,
            })
          : null;
        if (!target || !purgePlan) {
          return { ok: false as const, code: "BRANCH_POINT_INVALID" as const };
        }

        const runtimeParent = await this.resolveRuntimeParent(
          transaction as Transaction,
          conversations,
          input.userId,
          input.conversationId,
          target.parentMessageId,
        );
        if (!runtimeParent.ok) return runtimeParent.result;

        const attachmentBinding =
          new DrizzleNativeLiveAttachmentBinding(
            transaction as Transaction,
          );
        const originalAttachments =
          await attachmentBinding.readForMessage({
            userId: input.userId,
            messageId: target.id,
          });
        const selectedAttachmentIds =
          input.attachmentIds
          ?? originalAttachments.map(
            (attachment) => attachment.attachment_id,
          );
        if (
          input.text.length === 0
          && selectedAttachmentIds.length === 0
        ) {
          return {
            ok: false as const,
            code: "BRANCH_POINT_INVALID" as const,
          };
        }

        const editedUser = await conversations.appendUserMessage({
          userId: input.userId,
          conversationId: input.conversationId,
          parentMessageId: target.parentMessageId,
        });
        if (input.text.length > 0) {
          await conversations.appendContentBlock({
            userId: input.userId,
            conversationId: input.conversationId,
            messageId: editedUser.id,
            ordinal: 0,
            block: {
              kind: "text",
              rawType: "text",
              text: input.text,
            },
          });
        }
        const attachments =
          await attachmentBinding.bindReadyToMessage({
            userId: input.userId,
            messageId: editedUser.id,
            attachmentIds: selectedAttachmentIds,
            allowPreviouslyBound: true,
            startOrdinal:
              input.text.length > 0 ? 1 : 0,
          });

        const preparation = await this.insertPreparation(transaction, {
          prepareId: input.prepareId,
          userId: input.userId,
          requestId: input.requestId,
          conversationId: input.conversationId,
          operation: "edit",
          requestHash,
          canonicalUserMessageId: editedUser.id,
          replacementTargetUserMessageId: target.id,
          runtimeMode: runtimeParent.runtimeMode,
          parentProviderSessionId: runtimeParent.parentProviderSessionId,
          expectedWorkingDirectory: runtimeParent.expectedWorkingDirectory,
          parentProviderCheckpointId: runtimeParent.parentProviderCheckpointId ?? null,
          executionSelection: input.executionSelection,
          attachments,
          prompt:
            input.text.length > 0
              ? input.text
              : "The user sent the attached file(s).",
        });

        return {
          ok: true as const,
          outcome: "created" as const,
          preparation,
        };
      },
    );
  }

export async function persistMindPreparedPrompt(
  this: TurnRepositoryContext,
  input: {
    userId: string;
    prepareId: string;
    prompt: string;
  }): Promise<NativeLivePreparedTurn> {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new Error("Mind-prepared runtime prompt must be nonblank.");
    }

    return this.db.transaction(
      async (transaction) => {
        const row = await this.findById(
          transaction as Transaction,
          input.userId,
          input.prepareId,
          true,
        );
        if (!row) {
          throw new Error("Native live turn preparation was not found.");
        }
        if (row.mindPrepared) return mapPreparation(row);
        if (row.status !== "prepared") {
          throw new Error("Finalized turn preparation cannot change its prompt.");
        }

        const [updated] = await transaction
          .update(nativeLiveTurnPreparations)
          .set({
            prompt,
            mindPrepared: true,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(nativeLiveTurnPreparations.id, input.prepareId),
              eq(nativeLiveTurnPreparations.userId, input.userId),
              eq(nativeLiveTurnPreparations.status, "prepared"),
              eq(nativeLiveTurnPreparations.mindPrepared, false),
            ),
          )
          .returning(this.selection());

        if (updated) return mapPreparation(updated);

        const raced = await this.findById(
          transaction as Transaction,
          input.userId,
          input.prepareId,
          true,
        );
        if (!raced) {
          throw new Error("Native live turn preparation disappeared.");
        }
        return mapPreparation(raced);
      },
      { isolationLevel: "serializable" },
    );
  }

export async function prepareWithRaceRecovery(
  this: TurnRepositoryContext,
    userId: string,
    requestId: string,
    requestHash: string,
    work: (transaction: Transaction) => Promise<NativeLivePreparePortResult>,
  ): Promise<NativeLivePreparePortResult> {
    const existing = await this.findByRequest(this.db, userId, requestId);
    if (existing) return requestConflictOrReplay(existing, requestHash);

    try {
      return await this.db.transaction(
        async (transaction) => work(transaction as Transaction),
        { isolationLevel: "serializable" },
      );
    } catch (error) {
      const raced = await this.findByRequest(this.db, userId, requestId);
      if (raced) return requestConflictOrReplay(raced, requestHash);
      throw error;
    }
  }

export async function resolveRuntimeParent(
  this: TurnRepositoryContext,
    executor: Executor,
    conversations: DrizzleNativeLiveConversationRepository,
    userId: string,
    conversationId: string,
    parentMessageId: string | null,
    continuation: "send" | "replacement" = "replacement",
  ): Promise<
    | {
        ok: true;
        runtimeMode: NativeLiveRuntimeMode;
        parentProviderSessionId: string | null;
        expectedWorkingDirectory: string | null;
        parentProviderCheckpointId?: string | null;
      }
    | {
        ok: false;
        result: NativeLivePreparePortResult;
      }
  > {
    const [nativeSourceRow] = await executor.execute<{ metadata: Record<string, unknown> }>(sql`
      SELECT provider_metadata AS metadata FROM conversations
      WHERE id = ${conversationId}::uuid AND user_id = ${userId}::uuid`);
    const binding = nativeSourceRow ? nativeContinuationBinding(nativeSourceRow.metadata) : null;
    if (binding) {
      // Replacement may only touch turns created after the latest handoff. The
      // anchor itself is an execution cursor, never a synthetic UI message.
      if (continuation === "replacement" && binding.headMessageId !== parentMessageId) {
        const [floor] = await executor.execute<{ allowed: boolean }>(sql`
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_message_id FROM conversation_messages WHERE user_id = ${userId}::uuid
              AND conversation_id = ${conversationId}::uuid AND id = ${parentMessageId}::uuid
            UNION
            SELECT m.id, m.parent_message_id FROM conversation_messages m JOIN ancestors a ON a.parent_message_id = m.id
              WHERE m.user_id = ${userId}::uuid AND m.conversation_id = ${conversationId}::uuid
          ) SELECT EXISTS (SELECT 1 FROM ancestors WHERE
              ${binding.headMessageId}::uuid IS NULL OR id = ${binding.headMessageId}::uuid) AS allowed`);
        if (!floor?.allowed) return { ok: false, result: { ok: false, code: "BRANCH_POINT_INVALID" } };
      }
      if (binding.headMessageId === parentMessageId) {
        if (binding.owner !== "leileios") return { ok: false, result: { ok: false, code: "SESSION_OWNED_BY_DESKTOP" } };
        return { ok: true, runtimeMode: continuation === "send" ? "resume" : "fork",
          parentProviderSessionId: binding.sessionId, parentProviderCheckpointId: binding.checkpointId,
          expectedWorkingDirectory: binding.effectiveWorkingDirectory };
      }
    }
    if (!parentMessageId) {
      const bootstrapRows = await executor.execute<{
        source_provider_session_id: string;
        effective_working_directory: string;
      }>(sql`
        SELECT
          source_provider_session_id,
          effective_working_directory
        FROM native_live_conversation_provider_bootstraps
        WHERE user_id = ${userId}::uuid
          AND conversation_id = ${conversationId}::uuid
          AND provider = 'claude_code'
          AND consumed_at IS NULL
        LIMIT 1
      `);
      const bootstrap = bootstrapRows[0];
      if (bootstrap) {
        return {
          ok: true,
          runtimeMode: "fork",
          parentProviderSessionId:
            bootstrap.source_provider_session_id,

          expectedWorkingDirectory:
            bootstrap.effective_working_directory,
        };
      }

      return {
        ok: true,
        runtimeMode: "new",
        parentProviderSessionId: null,
        expectedWorkingDirectory: null,
      };
    }

    const checkpoint = await conversations.getProviderCheckpointForHead({
      userId,
      conversationId,
      canonicalMessageId: parentMessageId,
    });
    if (!checkpoint) {
      return {
        ok: false,
        result: { ok: false, code: "CHECKPOINT_NOT_FOUND" },
      };
    }
    if (!checkpoint.providerCheckpointId && checkpoint.runtimeMetadata?.provider_checkpoint_version === 1) {
      return { ok: false, result: { ok: false, code: "BRANCH_POINT_INVALID" } };
    }

    return {
      ok: true,
      runtimeMode: continuation === "send" && checkpoint.providerCheckpointId ? "resume" : "fork",
      parentProviderSessionId: checkpoint.providerSessionId,
      expectedWorkingDirectory: checkpoint.effectiveWorkingDirectory,
      parentProviderCheckpointId: continuation === "send" ? await readNativeResumeCheckpoint(executor, { userId, conversationId, canonicalMessageId: parentMessageId }) : checkpoint.providerCheckpointId,
    };
  }

export async function insertPreparation(
  this: TurnRepositoryContext,
    executor: Executor,
    input: {
      prepareId: string;
      userId: string;
      requestId: string;
      conversationId: string;
      operation: "send" | "retry" | "edit";
      requestHash: string;
      canonicalUserMessageId: string;
      replacementTargetUserMessageId: string | null;
      runtimeMode: "new" | "resume" | "fork";
      parentProviderSessionId: string | null;
      expectedWorkingDirectory: string | null;
      parentProviderCheckpointId?: string | null;
      executionSelection: NativeLiveExecutionSelection | null;
      attachments: NativeLiveRuntimeAttachment[];
      prompt: string;
    },
  ): Promise<NativeLivePreparedTurn> {
    const [row] = await executor
      .insert(nativeLiveTurnPreparations)
      .values({
        id: input.prepareId,
        userId: input.userId,
        requestId: input.requestId,
        conversationId: input.conversationId,
        operation: input.operation,
        requestHash: input.requestHash,
        canonicalUserMessageId: input.canonicalUserMessageId,
        replacementTargetUserMessageId: input.replacementTargetUserMessageId,
        runtimeMode: input.runtimeMode,
        parentProviderSessionId: input.parentProviderSessionId,
        expectedWorkingDirectory: input.expectedWorkingDirectory,
        parentProviderCheckpointId: input.parentProviderCheckpointId ?? null,
        executionSelection: input.executionSelection,
        attachments: input.attachments,
        prompt: input.prompt,
        mindPrepared: false,
        status: "prepared",
      })
      .returning(this.selection());

    if (!row) throw new Error("Native live turn preparation insert failed.");
    // Replace visible presentation ownership atomically with preparation creation.
    // The durable marker also prevents a delayed older failure from reclaiming this slot.
    await executor.update(conversations).set({
      providerMetadata: sql`jsonb_set(
        ${conversations.providerMetadata} - 'native_live_failed_turn',
        '{native_live_presentation_owner}',
        jsonb_build_object('prepareId', ${input.prepareId}::text,
          'anchorHeadMessageId', ${conversations.currentHeadMessageId})
      )`,
    }).where(and(eq(conversations.id,input.conversationId),eq(conversations.userId,input.userId)));
    return mapPreparation(row);
  }
