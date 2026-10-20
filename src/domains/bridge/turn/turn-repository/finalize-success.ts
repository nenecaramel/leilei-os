import {
  and,
  desc,
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
import { commitWakeResumeCursorLocked } from "./wake-resume-cursor.js";
import { matchesPresentationOwner } from "./presentation-owner.js";
import { commitRotatesWriterGeneration, syncNativeSessionOwner } from "./session-owner.js";

export async function finalizeSuccess(
  this: TurnRepositoryContext,
  input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    providerSessionId: string;
    effectiveWorkingDirectory: string | null;
    providerCheckpointId?: string | null;
    blocks: Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0]["blocks"];
    outputAttachmentIds: readonly string[];
    outputAttachmentMetadata?:
      Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0]["outputAttachmentMetadata"];
    normalizedEvents: readonly NativeLiveNormalizedEvent[];
    runtimeMetadata: NativeLiveRuntimeMetadata | null;
    mindFollowUp:
      Parameters<NativeLiveBackendTurnPort["finalizeSuccess"]>[0]["mindFollowUp"];
  }): Promise<NativeLiveFinalizeSuccessPortResult> {
    const resultHash = hashJson(RESULT_HASH_VERSION, {
      status: "success",
      providerSessionId: input.providerSessionId,
      effectiveWorkingDirectory: input.effectiveWorkingDirectory,
      ...(input.providerCheckpointId ? { providerCheckpointId: input.providerCheckpointId } : {}),
      normalizedEvents: input.normalizedEvents,
      outputAttachmentIds: input.outputAttachmentIds,
      ...(input.outputAttachmentMetadata?.length
        ? {
            outputAttachmentMetadata:
              input.outputAttachmentMetadata,
          }
        : {}),
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
          // The native-start fence lives on the preparation. It must survive
          // finalization, because a queued autonomous segment's later covering
          // proof must locate the exact foreground turn that started.
          const nativeInputBinding = (row.runtimeMetadata as Record<string, unknown> | null)
            ?.native_live_input_binding;
          if (nativeInputBinding && (
            typeof nativeInputBinding !== "object"
            || (nativeInputBinding as Record<string, unknown>).started !== true
          )) return { ok: false as const, code: "FINALIZE_CONFLICT" as const };

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
                presentationOwnerId: sql<string | null>`provider_metadata->'native_live_presentation_owner'->>'prepareId'`,
                presentationAnchorId: sql<string | null>`provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId'`,
                sourceRevision: sql<string | null>`provider_metadata->'nativeSessionSource'->>'revision'`,
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

            canonicalWritePhase = "wake_latest_user";
            const [latestUser] = await transaction
              .select({ id: conversationMessages.id })
              .from(conversationMessages)
              .innerJoin(
                conversationTable,
                and(
                  eq(
                    conversationTable.id,
                    conversationMessages.conversationId,
                  ),
                  eq(
                    conversationTable.userId,
                    conversationMessages.userId,
                  ),
                ),
              )
              .where(
                and(
                  eq(conversationMessages.userId, input.userId),
                  eq(conversationMessages.role, "user"),
                  eq(conversationTable.origin, "native_live"),
                  eq(
                    conversationTable.lifecycleStatus,
                    "active",
                  ),
                ),
              )
              .orderBy(
                desc(conversationMessages.createdAt),
                desc(conversationMessages.id),
              )
              .limit(1);

            const wakeGeneration = row.wakeContext?.runtime_generation;
            const wakeOwner = wakeGeneration && typeof wakeGeneration === "object" && !Array.isArray(wakeGeneration)
              ? wakeGeneration as Record<string, unknown> : null;
            // The visible Wake still belongs to the previous presentation
            // owner. A success must advance that owner's anchor from H to
            // Wake's assistant head; otherwise a later native Cron prepares
            // against H->Wake but its canonical background append gets 409.
            // Reject generation/owner changes before writing any visible row.
            if (
              !surface
              || surface.currentHeadMessageId
                !== wake.sourceHeadMessageId
              || latestUser?.id !== wake.sourceUserMessageId
              || !wakeOwner
              || !Object.hasOwn(wakeOwner, "presentation_owner_id")
              || !Object.hasOwn(wakeOwner, "source_revision")
              || surface.presentationOwnerId !== (wakeOwner.presentation_owner_id ?? null)
              || surface.sourceRevision !== (wakeOwner.source_revision ?? null)
              || surface.presentationAnchorId !== wake.sourceHeadMessageId
            ) {
              canonicalWritePhase = "wake_stale_cursor";
              // A later user message can make the visible Wake obsolete
              // while the original assistant head and SDK session still match.
              // Preserve the verified native tail before discarding its output,
              // otherwise the next input resumes at a stale CLI checkpoint.
              const recovered = row.runtimeMode === "resume" && input.providerCheckpointId
                ? await commitWakeResumeCursorLocked(transaction as Transaction, row, {
                    providerSessionId: input.providerSessionId,
                    providerCheckpointId: input.providerCheckpointId,
                    effectiveWorkingDirectory: input.effectiveWorkingDirectory,
                  })
                : "stale";
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
                ...(recovered === "superseded" || recovered === "current"
                  ? { nativeResumeCheckpointId: input.providerCheckpointId! } : {}),
              };
            }
          }

          let replacementPurgePlan: ReplacementPurgePlan | null = null;
          if (
            row.operation === "retry"
            || row.operation === "edit"
          ) {
            canonicalWritePhase = "replacement_ownership";
            // Lock/check the authoritative surface in this canonical transaction,
            // before planning descendants or writing any canonical artifact.
            // Serializable isolation also rejects a writer that changed this row
            // after our snapshot, rather than purging from an outdated snapshot.
            const [surface] = await transaction.select({
              ownsPresentation: matchesPresentationOwner(row.id),
            }).from(conversationTable).where(and(
              eq(conversationTable.userId, input.userId),
              eq(conversationTable.id, row.conversationId),
              eq(conversationTable.origin, "native_live"),
              eq(conversationTable.lifecycleStatus, "active"),
            )).for("update").limit(1);
            if (!surface?.ownsPresentation) {
              return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
            }
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
              attachmentMetadata: input.outputAttachmentMetadata,
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
          const [sessionGeneration] = await transaction.execute(sql`SELECT
            provider_metadata->'native_live_presentation_owner'->>'prepareId' AS presentation_owner_id,
            provider_metadata->'nativeSessionSource'->>'revision' AS source_revision
            FROM conversations WHERE id=${row.conversationId}::uuid AND user_id=${input.userId}::uuid FOR UPDATE`);
          // Shadow owner row: an edit, retry or fresh send starts a new native line.
          const writerGeneration = await syncNativeSessionOwner(transaction, {
            userId: input.userId, conversationId: row.conversationId,
            rotateGeneration: commitRotatesWriterGeneration(row),
          });
          canonicalWritePhase = "provider_checkpoint";
          const checkpoint = await conversations.bindProviderCheckpoint({
            userId: input.userId,
            conversationId: row.conversationId,
            canonicalMessageId: assistantMessage.id,
            checkpoint: {
              provider: "claude_code",
              providerSessionId: input.providerSessionId,
              effectiveWorkingDirectory: input.effectiveWorkingDirectory,
              providerCheckpointId: input.providerCheckpointId ?? null,
              runtimeMetadata:
                { ...(input.runtimeMetadata as Record<string, unknown> | null ?? {}),
                    ...(nativeInputBinding ? { native_live_input_binding: nativeInputBinding } : {}),
                    native_live_generation: { presentation_owner_id: sessionGeneration?.presentation_owner_id ?? null, source_revision: sessionGeneration?.source_revision ?? null, writer_generation: writerGeneration }, ...(input.providerCheckpointId ? { provider_checkpoint_version: 1 } : {}), turn_started_at: row.createdAt.toISOString(), ...(timingEvents.length ? { native_live_turn_timing_events: timingEvents } : {}) },
            },
          });

          canonicalWritePhase = "set_current_head";
          await conversations.setCurrentHead({
            userId: input.userId,
            conversationId: row.conversationId,
            messageId: assistantMessage.id,
          });

          // Both foreground F and a visible Wake advance the canonical head.
          // F owns a newly prepared presentation slot; a Wake does NOT replace
          // its source owner, but must advance that owner's anchor from H to
          // Wake's new assistant head. Without this, native Cron's later
          // background prepare is accepted, then its result fails the anchor
          // CAS and permanently fences the persistent SDK writer.
          canonicalWritePhase = "advance_presentation_anchor";
          if (sessionGeneration?.presentation_owner_id === row.id || row.operation === "wake") {
            const expectedOwner = row.operation === "wake"
              ? sessionGeneration?.presentation_owner_id ?? null : row.id;
            const anchors = await transaction.execute(sql`
              UPDATE conversations
              SET provider_metadata=jsonb_set(
                provider_metadata,
                '{native_live_presentation_owner,anchorHeadMessageId}',
                to_jsonb(${assistantMessage.id}::text)
              )
              WHERE id=${row.conversationId}::uuid
                AND user_id=${input.userId}::uuid
                AND current_head_message_id=${assistantMessage.id}::uuid
                AND (provider_metadata->'native_live_presentation_owner'->>'prepareId')
                  IS NOT DISTINCT FROM ${expectedOwner}::text
                AND (${row.operation === "wake"
                  ? sql`(provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId') IS NOT DISTINCT FROM ${wakeSourceHeadMessageId}::text`
                  : sql`true`})
              RETURNING id
            `);
            if (anchors.length !== 1)
              throw new Error("Native live presentation anchor changed before canonical finalization.");
            await syncNativeSessionOwner(transaction, { userId: input.userId, conversationId: row.conversationId });
          } else if (nativeInputBinding) {
            // A started native F must leave behind an unambiguous covering
            // owner for every deferred B that the SDK already generated.
            throw new Error("Native foreground owner changed before covering checkpoint finalization.");
          }

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
              runtimeMetadata: nativeInputBinding ? {
                ...(input.runtimeMetadata as Record<string, unknown> | null ?? {}),
                native_live_input_binding: nativeInputBinding,
              } : input.runtimeMetadata as Record<string, unknown> | null,
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
              actions: [],
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
        intent.kind === "memory"
          ? [nativeLiveMindFollowUpStateId(row.id, index)]
          : [],
    );

    if (!manifestLineage && selfWrittenStateIds.length === 0) {
      // Native schedule turns and legacy preparations normally have no
      // lineage-aware Context Manifest. With no authored Memory to
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
          lineage.seen_state_ids
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
              (record.type !== "memory")
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
    });
  }
