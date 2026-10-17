import type { NativeLiveBackendTurnPort } from "../native-live-backend-turn-coordinator.js";
import type { Transaction, TurnRepositoryContext } from "./types.js";
import { discardWakeLocked } from "./discard-wake.js";
import { commitWakeResumeCursorLocked } from "./wake-resume-cursor.js";

// A quiet Wake has no canonical message. Its *provider* continuation must
// nevertheless be persisted even when a new user intent appeared while Claude
// was running. If the original head still owns the same native session and no
// other SDK input has started, the verified Wake cursor can safely be retained
// invisibly. Without it, the next send hits PROVIDER_SESSION_CONFLICT.
export async function commitQuietWake(this: TurnRepositoryContext,
  input: Parameters<NonNullable<NativeLiveBackendTurnPort["commitQuietWake"]>>[0],
): Promise<"committed" | "superseded" | "stale"> {
  return this.db.transaction(async transaction => {
    const row = await this.findById(transaction as Transaction, input.userId, input.preparation.prepareId, true);
    if (!row) return "stale";
    if (row.status !== "prepared" || row.operation !== "wake" || row.runtimeMode !== "resume")
      throw new Error("Quiet cursor requires a prepared same-session wake.");
    const cursor = await commitWakeResumeCursorLocked(transaction as Transaction, row, {
      providerSessionId: input.providerSessionId,
      providerCheckpointId: input.providerCheckpointId,
      effectiveWorkingDirectory: input.effectiveWorkingDirectory,
    });
    await discardWakeLocked(transaction as Transaction, row, input.providerSessionId);
    return cursor === "current" ? "committed" : cursor;
  }, { isolationLevel: "serializable" });
}
