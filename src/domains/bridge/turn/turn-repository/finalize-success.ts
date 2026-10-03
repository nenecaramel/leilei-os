import {
  and,
  eq,
  sql,
} from "drizzle-orm";
import {
  conversationMessages,
  nativeLiveMindFollowUps,
  nativeLiveRuntimeInteractions,
  nativeLiveTurnPreparations,
  runtimeContextManifests,
  runtimeContextLineageStates,
} from "../../../../database/schema.js";
import { withCanonicalQuestionActivity } from "../../../conversation/native-live-question-activity.js";
import { DrizzleNativeLiveConversationRepository } from "../../../conversation/native-live-conversation-repository.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLiveFinalizeSuccessPortResult,
  NativeLivePreparedTurn,
} from "../native-live-backend-turn-coordinator.js";
import type { NativeLiveNormalizedEvent } from "../../../conversation/native-live-conversation-orchestrator.js";
import type { NativeLiveRuntimeMetadata } from "../../protocol/native-live-runtime-protocol.js";
import { DrizzleNativeLiveAttachmentBinding } from "../../attachment/native-live-attachment-service.js";
import {
  normalizeContextLineageState,
  parseContextLineageManifest,
} from "../../../runtime/context/context-lineage.js";
import { nativeLiveMindFollowUpStateId } from "../../mind/native-live-mind-state-id.js";
import {
  planReplacementMessagePurge,
  type ReplacementPurgePlan,
} from "../native-live-replacement-purge.js";
import type { TurnRepositoryContext } from "./types.js";
import {
  hashJson,
  RESULT_HASH_VERSION,
} from "./records.js";
import type {
  Transaction,
  PreparationRow,
} from "./types.js";

export async function finalizeSuccess(
  this: TurnRepositoryContext,
  input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    providerSessionId: string;
    workspaceId: string | null;
    effectiveWorkspaceRoot: string | null;
    blocks: Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0]["blocks"];
    outputAttachmentIds: readonly string[];
    normalizedEvents: readonly NativeLiveNormalizedEvent[];
    runtimeMetadata: NativeLiveRuntimeMetadata | null;
    mindFollowUp:
      Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0]["mindFollowUp"];
  }): Promise<NativeLiveFinalizeSuccessPortResult> {
    const resultHash = hashJson(RESULT_HASH_VERSION, {
      status: "success",
      providerSessionId: input.providerSessionId,
      workspaceId: input.workspaceId,
      effectiveWorkspaceRoot: input.effectiveWorkspaceRoot,
      normalizedEvents: input.normalizedEvents,
      outputAttachmentIds: input.outputAttachmentIds,
      ...(input.runtimeMetadata
        ? { runtimeMetadata: input.runtimeMetadata }
        : {}),
    });

    try {
      return await this.db.transaction(
        async (transaction) => {
          const row = await this.findById(
            transaction as Transaction,
            input.userId,
            input.preparation.prepareId,
            true,
          );
          if (!row) {
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }

          if (row.status === "finalized_success") {
            if (row.resultHash !== resultHash) {
              return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
            }
            const record = await this.loadFinalizedSuccess(
              transaction as Transaction,
              row,
            );
            return {
              ok: true as const,
              outcome: "idempotent" as const,
              record,
            };
          }
          if (row.status !== "prepared") {
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }

          const conversations =
            new DrizzleNativeLiveConversationRepository(
              transaction as Transaction,
            );

          let replacementPurgePlan: ReplacementPurgePlan | null = null;
          if (row.operation !== "send") {
            const conversation = await conversations.getConversation({
              userId: input.userId,
              conversationId: row.conversationId,
            });
            if (!conversation) {
              throw new Error(
                "Replacement finalization conversation was not found.",
              );
            }
            replacementPurgePlan = planReplacementMessagePurge({
              operation: row.operation,
              conversation,
              targetUserMessageId:
                row.replacementTargetUserMessageId
                ?? (
                  row.operation === "retry"
                    ? row.canonicalUserMessageId
                    : null
                ),
            });
            if (!replacementPurgePlan) {
              throw new Error(
                "Replacement finalization target is no longer on the current path.",
              );
            }
          }

          const assistantMessage = await conversations.appendAssistantMessage({
            userId: input.userId,
            conversationId: row.conversationId,
            parentMessageId: row.canonicalUserMessageId,
          });

          // Read trusted host decisions inside the canonical write transaction.
          // Provider tool_result output is free text and cannot prove answer vs cancel.
          const questionInteractions = input.blocks.some((block) =>
            block.kind === "tool_use" && block.payload?.tool_name === "AskUserQuestion",
          ) ? await transaction.select({
            kind: nativeLiveRuntimeInteractions.kind,
            status: nativeLiveRuntimeInteractions.status,
            request: nativeLiveRuntimeInteractions.request,
            response: nativeLiveRuntimeInteractions.response,
          }).from(nativeLiveRuntimeInteractions).where(and(
            eq(nativeLiveRuntimeInteractions.userId, input.userId),
            eq(nativeLiveRuntimeInteractions.prepareId, row.id),
            eq(nativeLiveRuntimeInteractions.kind, "question"),
          )) : [];
          const canonicalBlocks = withCanonicalQuestionActivity(input.blocks, questionInteractions);
          const blocks = [];
          for (const [ordinal, block] of canonicalBlocks.entries()) {
            blocks.push(
              await conversations.appendContentBlock({
                userId: input.userId,
                conversationId: row.conversationId,
                messageId: assistantMessage.id,
                ordinal,
                block,
              }),
            );
          }

          if (input.outputAttachmentIds.length > 0) {
            const attachmentBinding =
              new DrizzleNativeLiveAttachmentBinding(
                transaction as Transaction,
                8,
              );
            await attachmentBinding.bindReadyToMessage({
              userId: input.userId,
              messageId: assistantMessage.id,
              attachmentIds: input.outputAttachmentIds,
              startOrdinal: blocks.length,
            });
          }

          const checkpoint = await conversations.bindProviderCheckpoint({
            userId: input.userId,
            conversationId: row.conversationId,
            canonicalMessageId: assistantMessage.id,
            checkpoint: {
              provider: "claude_code",
              providerSessionId: input.providerSessionId,
              workspaceId: input.workspaceId,
              effectiveWorkspaceRoot: input.effectiveWorkspaceRoot,
              runtimeMetadata:
                input.runtimeMetadata as Record<string, unknown> | null,
            },
          });

          await conversations.setCurrentHead({
            userId: input.userId,
            conversationId: row.conversationId,
            messageId: assistantMessage.id,
          });

          await this.persistFinalizedContextLineage(
            transaction as Transaction,
            row,
            assistantMessage.id,
            input.mindFollowUp,
          );

          if (
            row.runtimeMode === "fork"
            && row.parentProviderSessionId
          ) {
            await transaction.execute(sql`
              UPDATE native_live_conversation_provider_bootstraps
              SET consumed_at = now()
              WHERE user_id = ${input.userId}::uuid
                AND conversation_id = ${row.conversationId}::uuid
                AND source_provider_session_id =
                  ${row.parentProviderSessionId}
                AND consumed_at IS NULL
            `);
          }

          const finalizedAt = new Date();
          const updated = await transaction
            .update(nativeLiveTurnPreparations)
            .set({
              status: "finalized_success",
              resultHash,
              providerSessionId: input.providerSessionId,
              runtimeMetadata:
                input.runtimeMetadata as Record<string, unknown> | null,
              assistantMessageId: assistantMessage.id,
              failureCode: null,
              finalizedAt,
              updatedAt: finalizedAt,
            })
            .where(
              and(
                eq(nativeLiveTurnPreparations.id, row.id),
                eq(nativeLiveTurnPreparations.userId, input.userId),
                eq(nativeLiveTurnPreparations.status, "prepared"),
              ),
            )
            .returning({ id: nativeLiveTurnPreparations.id });

          if (updated.length !== 1) {
            throw new Error("Native live turn finalization lost its preparation lock.");
          }

          if (
            replacementPurgePlan
            && replacementPurgePlan.rootMessageIds.length > 0
          ) {
            await this.purgeReplacementArtifacts(
              transaction as Transaction,
              row,
              replacementPurgePlan,
            );
          }

          if (input.mindFollowUp) {
            await transaction.insert(nativeLiveMindFollowUps).values({
              prepareId: row.id,
              userId: input.userId,
              conversationId: row.conversationId,
              assistantMessageId: assistantMessage.id,
              operation: row.operation,
              intents: input.mindFollowUp.intents.map((intent) => ({
                kind: intent.kind,
                text: intent.text,
                sourceStart: intent.sourceStart,
                sourceEnd: intent.sourceEnd,
                raw: intent.raw,
              })),
              actions: input.mindFollowUp.actions.map((action) => ({
                ...action,
              })),
              receipts: [],
              status: "pending",
              retryCount: 0,
            });
          }

          return {
            ok: true as const,
            outcome: "completed" as const,
            record: {
              assistantMessage: { ...assistantMessage, blocks },
              checkpoint,
            },
          };
        },
        { isolationLevel: "serializable" },
      );
    } catch {
      return { ok: false, code: "CANONICAL_WRITE_FAILURE" };
    }
  }

export async function persistFinalizedContextLineage(
  this: TurnRepositoryContext,
    transaction: Transaction,
    row: PreparationRow,
    assistantMessageId: string,
    mindFollowUp: Parameters<
      NativeLiveBackendTurnPort["finalizeSuccess"]
    >[0]["mindFollowUp"],
  ): Promise<void> {
    const [manifestRow] = await transaction
      .select({
        lineage: runtimeContextManifests.lineage,
        items: runtimeContextManifests.items,
      })
      .from(runtimeContextManifests)
      .where(
        and(
          eq(runtimeContextManifests.id, row.id),
          eq(runtimeContextManifests.userId, row.userId),
          eq(
            runtimeContextManifests.conversationId,
            row.conversationId,
          ),
        ),
      )
      .limit(1);

    const manifestLineage =
      parseContextLineageManifest(manifestRow?.lineage ?? null);

    const selfWrittenStateIds = (mindFollowUp?.intents ?? []).flatMap(
      (intent, index) =>
        intent.kind === "memory" || intent.kind === "feel"
          ? [nativeLiveMindFollowUpStateId(row.id, index)]
          : [],
    );

    if (!manifestLineage && selfWrittenStateIds.length === 0) {
      // Native schedule turns and legacy preparations normally have no
      // lineage-aware Context Manifest. With no authored Memory/Feel to
      // reserve, leaving no row makes the reader carry the nearest canonical
      // ancestor forward transparently.
      return;
    }

    const [userMessage] = await transaction
      .select({
        parentMessageId: conversationMessages.parentMessageId,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, row.canonicalUserMessageId),
          eq(conversationMessages.userId, row.userId),
          eq(conversationMessages.conversationId, row.conversationId),
        ),
      )
      .limit(1);
    if (!userMessage) {
      throw new Error(
        "Context lineage source user message was not found.",
      );
    }

    let parentLineage = normalizeContextLineageState(null);
    if (userMessage.parentMessageId) {
      const rows = await transaction.execute<{
        epoch: number;
        seen_state_ids: string[];
        thought_revision: number;
        thought_fingerprint: string | null;
      }>(sql`
        WITH RECURSIVE current_path AS (
          SELECT
            message.id,
            message.parent_message_id,
            0 AS depth
          FROM conversation_messages AS message
          WHERE message.id = ${userMessage.parentMessageId}::uuid
            AND message.user_id = ${row.userId}::uuid
            AND message.conversation_id = ${row.conversationId}::uuid

          UNION ALL

          SELECT
            parent.id,
            parent.parent_message_id,
            path.depth + 1
          FROM conversation_messages AS parent
          INNER JOIN current_path AS path
            ON parent.id = path.parent_message_id
          WHERE parent.user_id = ${row.userId}::uuid
            AND parent.conversation_id = ${row.conversationId}::uuid
        )
        SELECT
          lineage.epoch,
          lineage.seen_state_ids,
          lineage.thought_revision,
          lineage.thought_fingerprint
        FROM current_path AS path
        INNER JOIN runtime_context_lineage_states AS lineage
          ON lineage.canonical_message_id = path.id
         AND lineage.user_id = ${row.userId}::uuid
         AND lineage.conversation_id = ${row.conversationId}::uuid
        ORDER BY path.depth ASC
        LIMIT 1
      `);
      const parentRow = rows[0];
      parentLineage = normalizeContextLineageState(
        parentRow
          ? {
              epoch: Number(parentRow.epoch),
              seenStateIds: parentRow.seen_state_ids,
              thoughtRevision: Number(parentRow.thought_revision),
              thoughtFingerprint: parentRow.thought_fingerprint,
            }
          : null,
      );
    }

    if (
      manifestLineage
      && manifestLineage.epoch !== parentLineage.epoch
    ) {
      throw new Error(
        "Prepared context lineage no longer matches its parent checkpoint.",
      );
    }

    const injectedStateIds = manifestLineage
      ? (manifestRow?.items ?? []).flatMap(
          (item) => {
            if (
              !item
              || typeof item !== "object"
              || Array.isArray(item)
            ) {
              throw new Error(
                "Persisted Context Manifest item is invalid.",
              );
            }
            const record = item as Record<string, unknown>;
            const selection = record.selection;
            if (
              (record.type !== "memory" && record.type !== "feel")
              || typeof record.sourceId !== "string"
              || !selection
              || typeof selection !== "object"
              || Array.isArray(selection)
              || !String(
                (selection as Record<string, unknown>).reason ?? "",
              ).startsWith("breath_")
            ) {
              return [];
            }
            return [record.sourceId];
          },
        )
      : [];

    const seenStateIds = [
      ...new Set([
        ...parentLineage.seenStateIds,
        ...injectedStateIds,
        ...selfWrittenStateIds,
      ]),
    ];

    await transaction.insert(runtimeContextLineageStates).values({
      canonicalMessageId: assistantMessageId,
      userId: row.userId,
      conversationId: row.conversationId,
      epoch: manifestLineage?.epoch ?? parentLineage.epoch,
      seenStateIds,
      thoughtRevision:
        manifestLineage?.thoughtRevision
        ?? parentLineage.thoughtRevision,
      thoughtFingerprint:
        manifestLineage?.thoughtFingerprint
        ?? parentLineage.thoughtFingerprint,
    });
  }
