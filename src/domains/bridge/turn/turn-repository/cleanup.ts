import {
  and,
  eq,
  inArray,
  sql,
} from "drizzle-orm";
import { enforceThoughtCapacity } from "../../../runtime/thought/thought-runtime-repository.js";
import {
  conversationMessages,
  conversationProviderSessionCheckpoints,
  nativeLiveBackgroundModelJobs,
  nativeLiveProviderSessionCleanups,
  nativeLiveTurnPreparations,
  runtimeSubjectStates,
} from "../../../../database/schema.js";
import {
  planCausalSubjectStatePurge,
  planExclusiveProviderSessionCleanup,
  planSubjectStateRepairs,
  workflowReferencesAnyId,
  type ReplacementPurgePlan,
} from "../native-live-replacement-purge.js";
import type { TurnRepositoryContext } from "./types.js";
import type {
  Transaction,
  PreparationRow,
} from "./types.js";

export async function recoverStaleDeliveryUnknownTurn(
  this: TurnRepositoryContext,
  input: {
    userId: string;
    prepareId: string;
  }): Promise<boolean> {
    const updated = await this.db
      .update(nativeLiveTurnPreparations)
      .set({
        dispatchStatus: "rejected",
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        executionStartedAt: null,
        dispatchErrorCode: "RESULT_DELIVERY_UNKNOWN",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.prepareId),
          eq(nativeLiveTurnPreparations.status, "prepared"),
          eq(
            nativeLiveTurnPreparations.dispatchStatus,
            "delivery_unknown",
          ),
          sql`${nativeLiveTurnPreparations.deliveryUnknownAt}
            IS NOT NULL
            AND ${nativeLiveTurnPreparations.deliveryUnknownAt}
              <= now() - interval '30 seconds'`,
        ),
      )
      .returning({ id: nativeLiveTurnPreparations.id });

    return updated.length === 1;
  }

export async function purgeReplacementArtifacts(
  this: TurnRepositoryContext,
    transaction: Transaction,
    row: PreparationRow,
    plan: ReplacementPurgePlan,
  ): Promise<void> {
    const purgeMessageIds = new Set(plan.messageIds);
    if (purgeMessageIds.size === 0) return;

    const checkpoints = await transaction
      .select({
        canonicalMessageId:
          conversationProviderSessionCheckpoints.canonicalMessageId,
        provider:
          conversationProviderSessionCheckpoints.provider,
        providerSessionId:
          conversationProviderSessionCheckpoints.providerSessionId,
        workspaceId:
          conversationProviderSessionCheckpoints.workspaceId,
        effectiveWorkspaceRoot:
          conversationProviderSessionCheckpoints.effectiveWorkspaceRoot,
      })
      .from(conversationProviderSessionCheckpoints)
      .where(
        and(
          eq(
            conversationProviderSessionCheckpoints.userId,
            row.userId,
          ),
          eq(
            conversationProviderSessionCheckpoints.conversationId,
            row.conversationId,
          ),
        ),
      );

    const providerSessionIds =
      planExclusiveProviderSessionCleanup({
        purgeMessageIds,
        checkpoints,
      });
    if (providerSessionIds.length > 0) {
      await transaction
        .insert(nativeLiveProviderSessionCleanups)
        .values(
          providerSessionIds.map((providerSessionId) => {
            const sessionCheckpoints = checkpoints.filter(
              (checkpoint) =>
                checkpoint.providerSessionId === providerSessionId,
            );
            const bindings = new Map(
              sessionCheckpoints.map((checkpoint) => [
                JSON.stringify([
                  checkpoint.workspaceId,
                  checkpoint.effectiveWorkspaceRoot,
                ]),
                checkpoint,
              ]),
            );
            if (bindings.size > 1) {
              throw new Error(
                "Provider session is bound to multiple workspace roots.",
              );
            }
            const binding = bindings.values().next().value;
            return {
              userId: row.userId,
              provider: "claude_code" as const,
              providerSessionId,
              workspaceId: binding?.workspaceId ?? null,
              effectiveWorkspaceRoot:
                binding?.effectiveWorkspaceRoot ?? null,
              status: "pending" as const,
            };
          }),
        )
        .onConflictDoNothing();
    }

    const states = await transaction
      .select({
        id: runtimeSubjectStates.id,
        subjectId: runtimeSubjectStates.subjectId,
        kind: runtimeSubjectStates.kind,
        payload: runtimeSubjectStates.payload,
        envelope: runtimeSubjectStates.envelope,
        scopeConversationId: runtimeSubjectStates.scopeConversationId,
        scopePathHeadMessageId:
          runtimeSubjectStates.scopePathHeadMessageId,
      })
      .from(runtimeSubjectStates)
      .where(eq(runtimeSubjectStates.userId, row.userId));

    const purgeStateIds = planCausalSubjectStatePurge({
      purgeMessageIds,
      states,
    });
    const purgeStateIdSet = new Set(purgeStateIds);
    const stateRepairs = planSubjectStateRepairs({
      states,
      purgeMessageIds,
      purgeStateIds: purgeStateIdSet,
      memoryLifecyclePolicy: this.memoryLifecyclePolicy,
      repairedAt: new Date().toISOString(),
    });
    const causalIds = new Set<string>([
      ...purgeMessageIds,
      ...purgeStateIds,
    ]);

    const backgroundJobs = await transaction
      .select({
        id: nativeLiveBackgroundModelJobs.id,
        workflowKind: nativeLiveBackgroundModelJobs.workflowKind,
        workflowPayload: nativeLiveBackgroundModelJobs.workflowPayload,
      })
      .from(nativeLiveBackgroundModelJobs)
      .where(eq(nativeLiveBackgroundModelJobs.userId, row.userId));

    const purgeBackgroundJobIds = backgroundJobs
      .filter((job) =>
        workflowReferencesAnyId(
          job.workflowPayload,
          causalIds,
        )
      )
      .map((job) => job.id);

    if (purgeBackgroundJobIds.length > 0) {
      await transaction
        .delete(nativeLiveBackgroundModelJobs)
        .where(
          and(
            eq(nativeLiveBackgroundModelJobs.userId, row.userId),
            inArray(
              nativeLiveBackgroundModelJobs.id,
              purgeBackgroundJobIds,
            ),
          ),
        );
    }

    if (purgeStateIds.length > 0) {
      await transaction
        .delete(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.userId, row.userId),
            inArray(runtimeSubjectStates.id, purgeStateIds),
          ),
        );
    }

    for (const repair of stateRepairs) {
      await transaction
        .update(runtimeSubjectStates)
        .set({
          payload: repair.nextPayload,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(runtimeSubjectStates.userId, row.userId),
            eq(runtimeSubjectStates.id, repair.stateId),
          ),
        );
    }
    // A revived thought can push the active set past its limit.
    const revivedIds = new Set(
      stateRepairs
        .filter((repair) => repair.revivedThought)
        .map((repair) => repair.stateId),
    );
    const revivedSubjectIds = new Set(
      states
        .filter((state) => revivedIds.has(state.id))
        .map((state) => state.subjectId),
    );
    for (const subjectId of revivedSubjectIds) {
      await enforceThoughtCapacity(transaction, {
        userId: row.userId,
        subjectId,
        droppedAt: new Date().toISOString(),
      });
    }

    await transaction
      .delete(conversationMessages)
      .where(
        and(
          eq(conversationMessages.userId, row.userId),
          eq(conversationMessages.conversationId, row.conversationId),
          inArray(conversationMessages.id, plan.rootMessageIds),
        ),
      );
  }
