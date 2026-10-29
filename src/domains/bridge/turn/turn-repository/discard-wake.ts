import { and, eq, inArray, sql } from "drizzle-orm";
import {
  nativeLiveProviderSessionCleanups,
  nativeLiveSilenceWakeReceipts,
  nativeLiveTurnPreparations,
} from "../../../../database/schema.js";
import {
  silenceWakeReceiptCandidatesForPreparationId,
} from "../native-live-silence-wake.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLivePreparedTurn,
} from "../native-live-backend-turn-coordinator.js";
import type {
  PreparationRow,
  Transaction,
  TurnRepositoryContext,
} from "./types.js";

export async function discardWake(
  this: TurnRepositoryContext,
  input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    providerSessionId: string | null;
    failed?: boolean;
  },
): Promise<"discarded" | "idempotent"> {
  return this.db.transaction(
    async (transaction) => {
      const row = await this.findById(
        transaction as Transaction,
        input.userId,
        input.preparation.prepareId,
        true,
      );
      if (!row) {
        const discarded = await hasDiscardedWakeReceipt(
          transaction as Transaction,
          input.userId,
          input.preparation.prepareId,
        );
        if (discarded) return "idempotent";
        throw new Error("Silence wake preparation was not found.");
      }
      if (row.operation !== "wake") {
        throw new Error("Only silence wake preparations may be discarded.");
      }
      if (input.failed) await recordFailedWakeInputLocked(transaction as Transaction, row);
      await discardWakeLocked(
        transaction as Transaction,
        row,
        input.providerSessionId,
      );
      return "discarded";
    },
    { isolationLevel: "serializable" },
  );
}

export async function discardWakeLocked(
  transaction: Transaction,
  row: PreparationRow,
  providerSessionId: string | null,
): Promise<void> {
  if (row.operation !== "wake") {
    throw new Error("Only silence wake preparations may be discarded.");
  }

  // Only an isolated fork belongs to this discarded wake. Same-session work
  // may be quiet or stale without making its source session disposable.
  if (providerSessionId && row.runtimeMode === "fork"
    && row.parentProviderSessionId && providerSessionId !== row.parentProviderSessionId) {
    await transaction
      .insert(nativeLiveProviderSessionCleanups)
      .values({
        userId: row.userId,
        provider: "claude_code",
        providerSessionId,
        effectiveWorkingDirectory: row.expectedWorkingDirectory,
        status: "pending",
      })
      .onConflictDoNothing();
  }

  await transaction
    .delete(nativeLiveTurnPreparations)
    .where(
      and(
        eq(nativeLiveTurnPreparations.userId, row.userId),
        eq(nativeLiveTurnPreparations.id, row.id),
        eq(nativeLiveTurnPreparations.operation, "wake"),
      ),
    );
}

// A started same-session wake writes its prompt into the native transcript
// under its preparation id, right below the cursor it resumed from. Failing
// leaves that input there with no canonical trace. Record it on the cursor's
// checkpoint so the next send from that cursor may skip exactly this input.
export async function recordFailedWakeInputLocked(
  transaction: Transaction,
  row: PreparationRow,
): Promise<void> {
  if (row.operation !== "wake" || row.runtimeMode !== "resume"
    || !row.parentProviderSessionId || !row.parentProviderCheckpointId) return;
  const entry = JSON.stringify({
    input_id: row.id,
    provider_session_id: row.parentProviderSessionId,
    parent_checkpoint_id: row.parentProviderCheckpointId,
    cwd: row.expectedWorkingDirectory,
  });
  await transaction.execute(sql`
    UPDATE conversation_provider_session_checkpoints AS cp
    SET runtime_metadata = jsonb_set(coalesce(cp.runtime_metadata, '{}'::jsonb),
      '{native_live_failed_wake_inputs}',
      coalesce((SELECT jsonb_agg(kept.entry ORDER BY kept.n) FROM (
        SELECT previous.entry, previous.n
        FROM jsonb_array_elements(coalesce(cp.runtime_metadata->'native_live_failed_wake_inputs', '[]'::jsonb))
          WITH ORDINALITY AS previous(entry, n)
        WHERE previous.entry->>'input_id' <> ${row.id}
        ORDER BY previous.n DESC LIMIT 15) AS kept), '[]'::jsonb)
        || jsonb_build_array(${entry}::jsonb))
    WHERE cp.user_id = ${row.userId}::uuid AND cp.conversation_id = ${row.conversationId}::uuid
      AND cp.provider = 'claude_code' AND cp.provider_session_id = ${row.parentProviderSessionId}
      AND cp.effective_working_directory IS NOT DISTINCT FROM ${row.expectedWorkingDirectory}::text
      AND (cp.provider_checkpoint_id = ${row.parentProviderCheckpointId}
        OR cp.runtime_metadata->'native_live_resume_tail'->>'checkpoint_id' = ${row.parentProviderCheckpointId})
      AND EXISTS (SELECT 1 FROM native_live_turn_preparations AS wake
        WHERE wake.user_id = ${row.userId}::uuid AND wake.id = ${row.id}::uuid
          AND wake.execution_started_at IS NOT NULL)
  `);
}

export async function hasDiscardedWakeReceipt(
  executor: Transaction | TurnRepositoryContext["db"],
  userId: string,
  preparationId: string,
): Promise<boolean> {
  const candidates =
    silenceWakeReceiptCandidatesForPreparationId(preparationId);
  // One read for every slot this id could belong to (recurring wakes included).
  const receipts = await executor
    .select({
      epochId: nativeLiveSilenceWakeReceipts.epochId,
      slot: nativeLiveSilenceWakeReceipts.slot,
    })
    .from(nativeLiveSilenceWakeReceipts)
    .where(
      and(
        eq(nativeLiveSilenceWakeReceipts.userId, userId),
        inArray(
          nativeLiveSilenceWakeReceipts.epochId,
          [...new Set(candidates.map((candidate) => candidate.epochId))],
        ),
      ),
    );
  if (!receipts.some((receipt) => candidates.some((candidate) =>
    candidate.epochId === receipt.epochId && candidate.slot === receipt.slot))) {
    return false;
  }
  const [preparation] = await executor
    .select({ id: nativeLiveTurnPreparations.id })
    .from(nativeLiveTurnPreparations)
    .where(
      and(
        eq(nativeLiveTurnPreparations.userId, userId),
        eq(nativeLiveTurnPreparations.id, preparationId),
      ),
    )
    .limit(1);
  return !preparation;
}

export type NativeLiveDiscardWakePort = Pick<
  NativeLiveBackendTurnPort,
  "discardWake"
>;
