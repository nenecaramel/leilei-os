import { and, eq } from "drizzle-orm";
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

  if (providerSessionId) {
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

export async function hasDiscardedWakeReceipt(
  executor: Transaction | TurnRepositoryContext["db"],
  userId: string,
  preparationId: string,
): Promise<boolean> {
  const candidates =
    silenceWakeReceiptCandidatesForPreparationId(preparationId);
  for (const candidate of candidates) {
    const [receipt] = await executor
      .select({ epochId: nativeLiveSilenceWakeReceipts.epochId })
      .from(nativeLiveSilenceWakeReceipts)
      .where(
        and(
          eq(nativeLiveSilenceWakeReceipts.userId, userId),
          eq(nativeLiveSilenceWakeReceipts.epochId, candidate.epochId),
          eq(nativeLiveSilenceWakeReceipts.slot, candidate.slot),
        ),
      )
      .limit(1);
    if (!receipt) continue;

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
    if (!preparation) return true;
  }
  return false;
}

export type NativeLiveDiscardWakePort = Pick<
  NativeLiveBackendTurnPort,
  "discardWake"
>;
