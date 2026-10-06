import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  nativeLiveProviderSessionCleanups,
} from "../../../database/schema.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const CLEANUP_RESERVATION_LEASE_MS = 60_000;
const MAX_CLEANUP_ATTEMPTS = 5;

export type NativeLiveProviderSessionCleanupReservation = {
  reservationId: string;
  providerSessionId: string;
  effectiveWorkingDirectory: string | null;
};

export type NativeLiveProviderSessionCleanupCompletion =
  | { status: "success" }
  | { status: "failure"; failureCode: string };

export class NativeLiveProviderSessionCleanupError extends Error {
  constructor(
    readonly code:
      | "LISTENER_NOT_ACTIVE"
      | "RESERVATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveProviderSessionCleanupError";
  }
}

export class DrizzleNativeLiveProviderSessionCleanupRepository {
  constructor(private readonly db: Database) {}

  async reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveProviderSessionCleanupReservation | null> {
    return this.db.transaction(async (transaction) => {
      const lease = await transaction.execute<{ user_id: string }>(sql`
        UPDATE native_live_runtime_listener_leases
        SET lease_expires_at =
              now() + 60000 * interval '1 millisecond',
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND dispatch_target = 'claude_code'
          AND listener_instance_id = ${input.listenerInstanceId}::uuid
          AND lease_expires_at > now()
        RETURNING user_id
      `);
      if (lease.length !== 1) {
        throw new NativeLiveProviderSessionCleanupError(
          "LISTENER_NOT_ACTIVE",
          "Native live provider session cleanup requires an active listener lease.",
        );
      }

      await transaction.execute(sql`
        UPDATE native_live_provider_session_cleanups
        SET status = CASE
              WHEN attempt >= ${MAX_CLEANUP_ATTEMPTS}
                THEN 'failed'
              ELSE 'pending'
            END,
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            last_error_code = 'RESERVATION_EXPIRED',
            completed_at = CASE
              WHEN attempt >= ${MAX_CLEANUP_ATTEMPTS}
                THEN now()
              ELSE NULL
            END,
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'reserved'
          AND reservation_expires_at <= now()
      `);

      const rows = await transaction.execute<{
        id: string;
        provider_session_id: string;
        effective_working_directory: string | null;
      }>(sql`
        WITH candidate AS (
          SELECT id
          FROM native_live_provider_session_cleanups
          WHERE user_id = ${input.userId}::uuid
            AND status = 'pending'
            AND attempt < ${MAX_CLEANUP_ATTEMPTS}
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE native_live_provider_session_cleanups AS cleanup
        SET status = 'reserved',
            attempt = cleanup.attempt + 1,
            reserved_by = ${input.listenerInstanceId}::uuid,
            reserved_at = now(),
            reservation_expires_at =
              now() + ${CLEANUP_RESERVATION_LEASE_MS}
                * interval '1 millisecond',
            updated_at = now()
        FROM candidate
        WHERE cleanup.id = candidate.id
          AND cleanup.user_id = ${input.userId}::uuid
          AND cleanup.status = 'pending'
        RETURNING
          cleanup.id,
          cleanup.provider_session_id,
          cleanup.effective_working_directory
      `);

      const row = rows[0];
      return row
        ? {
            reservationId: row.id,
            providerSessionId: row.provider_session_id,
            effectiveWorkingDirectory: row.effective_working_directory,
          }
        : null;
    });
  }

  async complete(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    outcome: NativeLiveProviderSessionCleanupCompletion;
  }): Promise<"applied" | "idempotent"> {
    const failureCode =
      input.outcome.status === "failure"
        ? normalizeFailureCode(input.outcome.failureCode)
        : null;

    return this.db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          status: nativeLiveProviderSessionCleanups.status,
          attempt: nativeLiveProviderSessionCleanups.attempt,
          reservedBy: nativeLiveProviderSessionCleanups.reservedBy,
          lastErrorCode: nativeLiveProviderSessionCleanups.lastErrorCode,
        })
        .from(nativeLiveProviderSessionCleanups)
        .where(
          and(
            eq(nativeLiveProviderSessionCleanups.id, input.reservationId),
            eq(nativeLiveProviderSessionCleanups.userId, input.userId),
          ),
        )
        .for("update")
        .limit(1);

      if (!current) {
        throw new NativeLiveProviderSessionCleanupError(
          "RESERVATION_CONFLICT",
          "Provider session cleanup reservation was not found.",
        );
      }

      if (
        input.outcome.status === "success"
        && current.status === "completed"
      ) {
        return "idempotent" as const;
      }
      if (
        input.outcome.status === "failure"
        && current.status === "failed"
        && current.lastErrorCode === failureCode
      ) {
        return "idempotent" as const;
      }
      if (
        current.status !== "reserved"
        || current.reservedBy !== input.listenerInstanceId
      ) {
        throw new NativeLiveProviderSessionCleanupError(
          "RESERVATION_CONFLICT",
          "Provider session cleanup is not reserved by this listener.",
        );
      }

      const now = new Date();
      if (input.outcome.status === "success") {
        await transaction
          .update(nativeLiveProviderSessionCleanups)
          .set({
            status: "completed",
            reservedBy: null,
            reservedAt: null,
            reservationExpiresAt: null,
            lastErrorCode: null,
            completedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(
                nativeLiveProviderSessionCleanups.id,
                input.reservationId,
              ),
              eq(
                nativeLiveProviderSessionCleanups.userId,
                input.userId,
              ),
              eq(
                nativeLiveProviderSessionCleanups.status,
                "reserved",
              ),
              eq(
                nativeLiveProviderSessionCleanups.reservedBy,
                input.listenerInstanceId,
              ),
            ),
          );
        return "applied" as const;
      }

      const terminal =
        current.attempt >= MAX_CLEANUP_ATTEMPTS;
      await transaction
        .update(nativeLiveProviderSessionCleanups)
        .set({
          status: terminal ? "failed" : "pending",
          reservedBy: null,
          reservedAt: null,
          reservationExpiresAt: null,
          lastErrorCode: failureCode,
          completedAt: terminal ? now : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(
              nativeLiveProviderSessionCleanups.id,
              input.reservationId,
            ),
            eq(
              nativeLiveProviderSessionCleanups.userId,
              input.userId,
            ),
            eq(nativeLiveProviderSessionCleanups.status, "reserved"),
            eq(
              nativeLiveProviderSessionCleanups.reservedBy,
              input.listenerInstanceId,
            ),
          ),
        );
      return "applied" as const;
    });
  }
}

export class NativeLiveProviderSessionCleanupService {
  constructor(
    private readonly repository:
      DrizzleNativeLiveProviderSessionCleanupRepository,
  ) {}

  reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveProviderSessionCleanupReservation | null> {
    return this.repository.reserveNext(input);
  }

  complete(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    outcome: NativeLiveProviderSessionCleanupCompletion;
  }): Promise<"applied" | "idempotent"> {
    return this.repository.complete(input);
  }
}

function normalizeFailureCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return "DELETE_SESSION_FAILED";
  return normalized.slice(0, 64);
}
