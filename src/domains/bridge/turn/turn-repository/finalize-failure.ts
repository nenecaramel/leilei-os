import {
  and,
  eq,
  asc,
  sql,
  or,
} from "drizzle-orm";
import { conversations, nativeLiveRuntimeEvents, nativeLiveRuntimeInteractions, nativeLiveTurnPreparations } from "../../../../database/schema.js";
import type {
  NativeLiveFinalizeFailurePortResult,
  NativeLivePreparedTurn,
} from "../native-live-backend-turn-coordinator.js";
import type {
  NativeLiveRuntimeFailureCode,
  NativeLiveRuntimeMetadata,
} from "../../protocol/native-live-runtime-protocol.js";
import type { TurnRepositoryContext } from "./types.js";
import {
  hashJson,
  RESULT_HASH_VERSION,
} from "./records.js";
import { DrizzleNativeLiveConversationRepository } from "../../../conversation/native-live-conversation-repository.js";
import type { Transaction } from "./types.js";
import type { NativeLiveFailedTurnEvidence } from "../../../conversation/native-live-conversation-types.js";

export async function finalizeFailure(
  this: TurnRepositoryContext,
  input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    errorCode: NativeLiveRuntimeFailureCode | "RUNTIME_PROTOCOL_ERROR";
    runtimeMetadata: NativeLiveRuntimeMetadata | null;
  }): Promise<NativeLiveFinalizeFailurePortResult> {
    const resultHash = hashJson(RESULT_HASH_VERSION, {
      status: "failure",
      errorCode: input.errorCode,
      runtimeMetadata: input.runtimeMetadata,
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
          if (row.status === "finalized_failure") {
            if (
              row.resultHash === resultHash
              && row.failureCode === input.errorCode
            ) {
              return { ok: true as const, outcome: "idempotent" as const };
            }
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }
          if (row.status !== "prepared") {
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }

          const finalizedAt = new Date();
          // Failure has no canonical assistant. Persist a presentation sidecar independently
          // of operational preparation/events so teardown, reopen and retention share one truth.
          const conversation = await new DrizzleNativeLiveConversationRepository(
            transaction as Transaction,
          ).getConversation({ userId: input.userId, conversationId: row.conversationId });
          const preparedUserMessage = conversation?.messages.find(
            message => message.id === row.canonicalUserMessageId && message.role === "user",
          );
          if (!conversation || !preparedUserMessage) {
            throw new Error("Failed turn user was not found.");
          }
          let events = await transaction.select().from(nativeLiveRuntimeEvents).where(and(
            eq(nativeLiveRuntimeEvents.userId, input.userId),
            eq(nativeLiveRuntimeEvents.prepareId, row.id),
          )).orderBy(asc(nativeLiveRuntimeEvents.sequence));
          // SDK throws/aborts can submit a failure envelope without a provider error.
          // Give both the foreground reader and retained overlay the same durable boundary.
          if (!events.some(event => ["result", "error"].includes(event.eventType))) {
            const terminalEvents = await transaction.insert(nativeLiveRuntimeEvents).values({
              userId: input.userId, prepareId: row.id,
              sequence: (events.at(-1)?.sequence ?? 0) + 1,
              eventType: "error", payload: { code: input.errorCode }, createdAt: finalizedAt,
            }).returning();
            events = [...events, ...terminalEvents];
          }
          const interactions = await transaction.select().from(nativeLiveRuntimeInteractions).where(and(
            eq(nativeLiveRuntimeInteractions.userId, input.userId),
            eq(nativeLiveRuntimeInteractions.prepareId, row.id),
          ));
          const evidence: NativeLiveFailedTurnEvidence = {
            prepareId: row.id,
            requestId: row.requestId,
            conversationId: row.conversationId,
            operation: row.operation,
            userMessageId: row.canonicalUserMessageId,
            preparedUserMessage,
            replacementTargetUserMessageId: row.replacementTargetUserMessageId
              ?? (row.operation === "retry" ? row.canonicalUserMessageId : null),
            anchorHeadMessageId: conversation.currentHeadMessageId,
            startedAt: row.createdAt.toISOString(),
            failureCode: input.errorCode,
            events: events.map(event => {
              const payload = event.payload ? { ...event.payload } : null;
              if (payload && ["tool_use", "tool_result"].includes(event.eventType)) {
                delete payload.display_name;
                delete payload.server_display_name;
                delete payload.icon_url;
              }
              return {
                sequence: event.sequence,
                createdAt: event.createdAt.toISOString(),
                event: {
                  type: event.eventType,
                  ...(event.providerSessionId ? { provider_session_id: event.providerSessionId } : {}),
                  ...(payload ? { payload } : {}),
                },
              };
            }),
            interactions: interactions.map(interaction => ({
              interactionId: interaction.id,
              prepareId: row.id,
              kind: interaction.kind,
              request: interaction.request,
              status: interaction.status,
              response: interaction.response,
              createdAt: interaction.createdAt.toISOString(),
              updatedAt: interaction.updatedAt.toISOString(),
              resolvedAt: interaction.resolvedAt?.toISOString() ?? null,
              cancelledAt: interaction.cancelledAt?.toISOString() ?? null,
            })),
          };
          await transaction.update(conversations).set({
            providerMetadata: sql`jsonb_set(${conversations.providerMetadata}, '{native_live_failed_turn}', ${JSON.stringify(evidence)}::jsonb)`,
            updatedAt: finalizedAt,
          }).where(and(
            eq(conversations.id,row.conversationId),
            eq(conversations.userId,input.userId),
            or(
              // Compatibility for preparations created before presentation ownership existed.
              sql`${conversations.providerMetadata}->'native_live_presentation_owner' IS NULL`,
              and(
                sql`${conversations.providerMetadata}->'native_live_presentation_owner'->>'prepareId' = ${row.id}`,
                sql`(${conversations.providerMetadata}->'native_live_presentation_owner'->>'anchorHeadMessageId') IS NOT DISTINCT FROM ${conversations.currentHeadMessageId}::text`,
              ),
            ),
          ));
          const updated = await transaction
            .update(nativeLiveTurnPreparations)
            .set({
              status: "finalized_failure",
              resultHash,
              providerSessionId: null,
              assistantMessageId: null,
              failureCode: input.errorCode,
              runtimeMetadata:
                input.runtimeMetadata as Record<string, unknown> | null,
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
            return { ok: false as const, code: "FINALIZE_CONFLICT" as const };
          }
          return { ok: true as const, outcome: "recorded" as const };
        },
        { isolationLevel: "serializable" },
      );
    } catch {
      return { ok: false, code: "FINALIZE_CONFLICT" };
    }
  }
