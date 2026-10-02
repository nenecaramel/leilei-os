import {
  and,
  eq,
} from "drizzle-orm";
import { nativeLiveTurnPreparations } from "../../../../database/schema.js";
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
import type { Transaction } from "./types.js";

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
