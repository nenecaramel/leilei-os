import {
  and,
  eq,
  sql,
} from "drizzle-orm";
import {
  conversationMessages,
  conversations as conversationTable,
  nativeLiveMindFollowUps,
  nativeLiveRuntimeInteractions,
  nativeLiveRuntimeEvents,
  nativeLiveTurnPreparations,
  runtimeContextManifests,
  runtimeContextLineageStates,
} from "../../../../database/schema.js";
import { readDurableTurnTimingEvents } from "../../../conversation/native-live-turn-timing.js";
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
import { discardWakeLocked } from "./discard-wake.js";

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

    let canonicalWritePhase = "transaction_start";
    try {
      return await this.db.transaction(
        async (transaction) => {
          canonicalWritePhase = "load_preparation";
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

          let wakeSourceHeadMessageId: string | null = null;
          if (row.operation === "wake") {
            canonicalWritePhase = "wake_context";
            const wake = readWakeContext(row);
            wakeSourceHeadMessageId = wake.sourceHeadMessageId;

            canonicalWritePhase = "wake_surface";
            const [surface] = await transaction
              .select({
                currentHeadMessageId:
                  conversationTable.currentHeadMessageId,
              })
              .from(conversationTable)
              .where(
                and(
                  eq(conversationTable.userId, input.userId),
                  eq(conversationTable.id, row.conversationId),
                  eq(conversationTable.origin, "native_live"),
                  eq(conversationTable.lifecycleStatus, "active"),
                ),
              )
              .for("update")
              .limit(1);

            canonicalWritePhase = "wake_source_user";
            const [sourceUser] = await transaction
              .select({
                id: conversationMessages.id,
                createdAt: conversationMessages.createdAt,
              })
              .from(conversationMessages)
              .where(
                and(
                  eq(conversationMessages.userId, input.userId),
                  eq(conversationMessages.id, wake.sourceUserMessageId),
                  eq(conversationMessages.role, "user"),
                ),
              )
              .limit(1);

            canonicalWritePhase = "wake_newer_user";
            const newerUser = sourceUser
              ? await transaction.execute<{ id: string }>(sql`
                  SELECT message.id
                  FROM conversation_messages AS message
                  JOIN conversations AS conversation
                    ON conversation.id = message.conversation_id
                   AND conversation.user_id = message.user_id
                  WHERE message.user_id = ${input.userId}::uuid
                    AND message.role = 'user'
                    AND conversation.origin = 'native_live'
                    AND conversation.lifecycle_status = 'active'
                    AND (
                      message.created_at > ${sourceUser.createdAt}
                      OR (
                        message.created_at = ${sourceUser.createdAt}
                        AND message.id <> ${sourceUser.id}::uuid
                      )
                    )
                  LIMIT 1
                `)
              : [{ id: "missing-source-user" }];

            if (
              !surface
              || surface.currentHeadMessageId
                !== wake.sourceHeadMessageId
              || newerUser.length > 0
            ) {
              canonicalWritePhase = "wake_stale_discard";
              await discardWakeLocked(
                transaction as Transaction,
                row,
                input.providerSessionId,
              );
              return {
                ok: true as const,
                outcome: "wake_discarded" as const,
                record: null,
              };
            }
          }

          let replacementPurgePlan: ReplacementPurgePlan | null = null;
          if (
            row.operation === "retry"
            || row.operation === "edit"
          ) {
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

          canonicalWritePhase = "assistant_message";
          const assistantMessage =
            row.operation === "wake"
              ? await appendWakeAssistantMessage(
                  transaction as Transaction,
                  {
                    userId: input.userId,
                    conversationId: row.conversationId,
                    parentMessageId: wakeSourceHeadMessageId!,
                  },
                )
              : await conversations.appendAssistantMessage({
                  userId: input.userId,
                  conversationId: row.conversationId,
                  parentMessageId:
                    requireCanonicalUserMessageId(row),
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
          canonicalWritePhase = "content_blocks";
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
              contentOrigin: "provider_send",
            });
          }

          const finalizedAt = new Date();
          const timingEvents = await readDurableTurnTimingEvents(transaction as Transaction, input.userId, row.id);
          // A terminal batch can exhaust relay retries while the success envelope arrives.
          // Preserve one server-owned boundary for runtime readers and canonical reopen.
          if (timingEvents.length === 1) {
            const [tail] = await transaction.select({ sequence: sql<number>`coalesce(max(${nativeLiveRuntimeEvents.sequence}), 0)` })
              .from(nativeLiveRuntimeEvents).where(and(
                eq(nativeLiveRuntimeEvents.userId, input.userId), eq(nativeLiveRuntimeEvents.prepareId, row.id),
              ));
            const sequence = (tail?.sequence ?? 0) + 1;
            await transaction.insert(nativeLiveRuntimeEvents).values({
              userId: input.userId, prepareId: row.id, sequence,
              eventType: "result", payload: { status: "success" }, createdAt: finalizedAt,
            });
            timingEvents.push({ sequence, event: { type: "result" }, createdAt: finalizedAt.toISOString() });
          }
          canonicalWritePhase = "provider_checkpoint";
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
                { ...(input.runtimeMetadata as Record<string, unknown> | null ?? {}), turn_started_at: row.createdAt.toISOString(), ...(timingEvents.length ? { native_live_turn_timing_events: timingEvents } : {}) },
            },
          });

          canonicalWritePhase = "set_current_head";
          await conversations.setCurrentHead({
            userId: input.userId,
            conversationId: row.conversationId,
            messageId: assistantMessage.id,
          });

          canonicalWritePhase = "context_lineage";
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

          canonicalWritePhase = "finalize_preparation";
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
            canonicalWritePhase = "mind_followup";
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
    } catch (error) {
      logCanonicalWriteFailure(
        input.preparation.prepareId,
        input.preparation.operation,
        canonicalWritePhase,
        error,
      );
      return { ok: false, code: "CANONICAL_WRITE_FAILURE" };
    }
  }

function logCanonicalWriteFailure(
  prepareId: string,
  operation: PreparationRow["operation"],
  phase: string,
  error: unknown,
): void {
  const record =
    error && typeof error === "object"
      ? error as Record<string, unknown>
      : {};
  process.stderr.write(
    JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      event: "native_live_canonical_write_failed",
      prepareId,
      operation,
      phase,
      errorName:
        error instanceof Error
          ? error.name
          : "UnknownError",
      ...(
        typeof record.code === "string"
          ? { errorCode: record.code }
          : {}
      ),
      ...(
        typeof record.constraint_name === "string"
          ? { constraintName: record.constraint_name }
          : typeof record.constraint === "string"
            ? { constraintName: record.constraint }
            : {}
      ),
      ...(
        typeof record.table_name === "string"
          ? { tableName: record.table_name }
          : typeof record.table === "string"
            ? { tableName: record.table }
            : {}
      ),
    }) + "\n",
  );
}

function requireCanonicalUserMessageId(
  row: PreparationRow,
): string {
  if (!row.canonicalUserMessageId) {
    throw new Error(
      "Foreground turn is missing its canonical user message.",
    );
  }
  return row.canonicalUserMessageId;
}

function readWakeContext(row: PreparationRow): {
  sourceUserMessageId: string;
  sourceHeadMessageId: string;
} {
  const context = row.wakeContext;
  const sourceUserMessageId = context?.source_user_message_id;
  const sourceHeadMessageId = context?.source_head_message_id;
  if (
    typeof sourceUserMessageId !== "string"
    || typeof sourceHeadMessageId !== "string"
  ) {
    throw new Error("Silence wake context is invalid.");
  }
  return { sourceUserMessageId, sourceHeadMessageId };
}

async function appendWakeAssistantMessage(
  transaction: Transaction,
  input: {
    userId: string;
    conversationId: string;
    parentMessageId: string;
  },
) {
  const now = new Date();
  const [row] = await transaction
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
  if (!row || row.role !== "assistant") {
    throw new Error("Silence wake assistant message insert failed.");
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    parentMessageId: row.parentMessageId,
    role: "assistant" as const,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    blocks: [],
  };
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

    let parentMessageId: string | null;
    if (row.operation === "wake") {
      parentMessageId = readWakeContext(row).sourceHeadMessageId;
    } else {
      const canonicalUserMessageId =
        requireCanonicalUserMessageId(row);
      const [userMessage] = await transaction
        .select({
          parentMessageId: conversationMessages.parentMessageId,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.id, canonicalUserMessageId),
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
      parentMessageId = userMessage.parentMessageId;
    }

    let parentLineage = normalizeContextLineageState(null);
    if (parentMessageId) {
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
          WHERE message.id = ${parentMessageId}::uuid
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
