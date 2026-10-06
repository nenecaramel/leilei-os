import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  nativeLiveRuntimeListenerLeases,
  nativeLiveTurnPreparations,
} from "../../../database/schema.js";
import {
  nativeLiveRuntimeCommandFromPreparation,
  type NativeLiveBackendTurnCoordinator,
  type NativeLiveFinalizeFailureCode,
  type NativeLiveFinalizeResult,
  type NativeLivePreparedTurn,
} from "../turn/native-live-backend-turn-coordinator.js";
import type {
  NativeLiveDaemonLeaseState,
  NativeLiveDaemonRejectCode,
  NativeLiveDaemonReservation,
} from "../mac/native-live-mac-daemon-loop.js";
import type {
  NativeLiveRuntimeExecutionResult,
} from "../protocol/native-live-runtime-protocol.js";
import { parseNativeLiveExecutionSelection } from "../turn/native-live-execution-selection.js";
import { hasDiscardedWakeReceipt } from "../turn/turn-repository/discard-wake.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const LISTENER_LEASE_MS = 60_000;
const RESERVATION_LEASE_MS = 60_000;

type RelayMutationOutcome =
  | "applied"
  | "idempotent"
  | "not_found"
  | "conflict";

export interface NativeLiveBackendRelayPort {
  enqueuePreparation(input: {
    userId: string;
    prepareId: string;
  }): Promise<RelayMutationOutcome>;
  renewLease(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveDaemonLeaseState>;
  reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLivePreparedTurn | null>;
  markExecutionStarted(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<RelayMutationOutcome>;
  ownsSubmitReservation(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<boolean>;
  isDiscardedWakeReservation?(input: {
    userId: string;
    reservationId: string;
  }): Promise<boolean>;
  markCompleted(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<RelayMutationOutcome>;
  markDeliveryUnknown(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<RelayMutationOutcome>;
  rejectReservation(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    code: NativeLiveDaemonRejectCode;
  }): Promise<RelayMutationOutcome>;
}

type RelayPreparationRow = NativeLivePreparedTurn & {
  dispatchStatus:
    | "staged"
    | "pending"
    | "reserved"
    | "executing"
    | "delivery_unknown"
    | "completed"
    | "rejected";
  reservedBy: string | null;
};

const preparationSelection = {
  prepareId: nativeLiveTurnPreparations.id,
  requestId: nativeLiveTurnPreparations.requestId,
  userId: nativeLiveTurnPreparations.userId,
  conversationId: nativeLiveTurnPreparations.conversationId,
  operation: nativeLiveTurnPreparations.operation,
  canonicalUserMessageId:
    nativeLiveTurnPreparations.canonicalUserMessageId,
  wakeContext: nativeLiveTurnPreparations.wakeContext,
  runtimeMode: nativeLiveTurnPreparations.runtimeMode,
  parentProviderSessionId:
    nativeLiveTurnPreparations.parentProviderSessionId,
  expectedWorkingDirectory:
    nativeLiveTurnPreparations.expectedWorkingDirectory,
  parentProviderCheckpointId: nativeLiveTurnPreparations.parentProviderCheckpointId,
  executionSelection: nativeLiveTurnPreparations.executionSelection,
  attachments: nativeLiveTurnPreparations.attachments,
  prompt: nativeLiveTurnPreparations.prompt,
  mindPrepared: nativeLiveTurnPreparations.mindPrepared,
  dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
  reservedBy: nativeLiveTurnPreparations.reservedBy,
};

type SelectedRelayPreparationRow = {
  prepareId: string;
  requestId: string;
  userId: string;
  conversationId: string;
  operation: "send" | "retry" | "edit" | "wake";
  canonicalUserMessageId: string | null;
  wakeContext: Record<string, unknown> | null;
  runtimeMode: "new" | "resume" | "fork";
  parentProviderSessionId: string | null;
  expectedWorkingDirectory: string | null;
  parentProviderCheckpointId?: string | null;
  executionSelection: Record<string, unknown> | null;
  attachments: Array<Record<string, unknown>>;
  prompt: string;
  mindPrepared: boolean;
  dispatchStatus: RelayPreparationRow["dispatchStatus"];
  reservedBy: string | null;
};

function mapPreparation(
  row: SelectedRelayPreparationRow,
): RelayPreparationRow {
  return {
    ...row,
    executionSelection: row.executionSelection === null
      ? null
      : parseNativeLiveExecutionSelection(row.executionSelection),
    attachments: parseRelayAttachments(row.attachments),
  };
}

function parseRelayAttachments(
  value: Array<Record<string, unknown>>,
): NonNullable<NativeLivePreparedTurn["attachments"]> {
  return value.map((item) => {
    const attachmentId = item.attachment_id;
    const filename = item.filename;
    const mimeType = item.mime_type;
    const sizeBytes = item.size_bytes;
    const sha256 = item.sha256;
    const kind = item.kind;

    if (
      typeof attachmentId !== "string"
      || typeof filename !== "string"
      || typeof mimeType !== "string"
      || typeof sizeBytes !== "number"
      || !Number.isSafeInteger(sizeBytes)
      || sizeBytes <= 0
      || typeof sha256 !== "string"
      || !/^[0-9a-f]{64}$/u.test(sha256)
      || (kind !== "image" && kind !== "file")
    ) {
      throw new Error(
        "Stored Native Live relay attachment descriptor is invalid.",
      );
    }

    return {
      attachment_id: attachmentId,
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      sha256,
      kind,
    };
  });
}

export class NativeLiveBackendRelayError extends Error {
  constructor(
    readonly code:
      | "LISTENER_BUSY"
      | "LISTENER_NOT_ACTIVE"
      | "RESERVATION_CONFLICT"
      | "FINALIZE_REJECTED",
    message: string,
    readonly finalizeCode: NativeLiveFinalizeFailureCode | null = null,
  ) {
    super(message);
    this.name = "NativeLiveBackendRelayError";
  }
}

export class DrizzleNativeLiveBackendRelayRepository
implements NativeLiveBackendRelayPort {
  constructor(private readonly db: Database) {}

  async enqueuePreparation(input: {
    userId: string;
    prepareId: string;
  }): Promise<RelayMutationOutcome> {
    const updated = await this.db
      .update(nativeLiveTurnPreparations)
      .set({
        dispatchStatus: "pending",
        dispatchErrorCode: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.prepareId),
          eq(nativeLiveTurnPreparations.status, "prepared"),
          eq(nativeLiveTurnPreparations.dispatchStatus, "staged"),
        ),
      )
      .returning({ id: nativeLiveTurnPreparations.id });

    if (updated.length === 1) return "applied";

    const [current] = await this.db
      .select({
        status: nativeLiveTurnPreparations.status,
        dispatchStatus: nativeLiveTurnPreparations.dispatchStatus,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.prepareId),
        ),
      )
      .limit(1);

    if (!current) return "not_found";
    if (current.dispatchStatus !== "staged") {
      return "idempotent";
    }
    return "conflict";
  }

  async renewLease(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveDaemonLeaseState> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${input.userId + ":claude_code"}, 0)
        )
      `);

      const [existing] = await transaction
        .select({
          listenerInstanceId:
            nativeLiveRuntimeListenerLeases.listenerInstanceId,
          active: sql<boolean>`${nativeLiveRuntimeListenerLeases.leaseExpiresAt} > now()`,
        })
        .from(nativeLiveRuntimeListenerLeases)
        .where(
          and(
            eq(nativeLiveRuntimeListenerLeases.userId, input.userId),
            eq(
              nativeLiveRuntimeListenerLeases.dispatchTarget,
              "claude_code",
            ),
          ),
        )
        .for("update")
        .limit(1);

      if (
        existing?.active
        && existing.listenerInstanceId !== input.listenerInstanceId
      ) {
        return "busy";
      }

      const state: NativeLiveDaemonLeaseState =
        existing?.listenerInstanceId === input.listenerInstanceId
          ? "renewed"
          : "acquired";

      await transaction
        .insert(nativeLiveRuntimeListenerLeases)
        .values({
          userId: input.userId,
          dispatchTarget: "claude_code",
          listenerInstanceId: input.listenerInstanceId,
          leaseExpiresAt: sql`now() + ${LISTENER_LEASE_MS} * interval '1 millisecond'`,
          updatedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: [
            nativeLiveRuntimeListenerLeases.userId,
            nativeLiveRuntimeListenerLeases.dispatchTarget,
          ],
          set: {
            listenerInstanceId: input.listenerInstanceId,
            leaseExpiresAt: sql`now() + ${LISTENER_LEASE_MS} * interval '1 millisecond'`,
            updatedAt: sql`now()`,
          },
        });

      return state;
    });
  }

  async reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLivePreparedTurn | null> {
    return this.db.transaction(async (transaction) => {
      const lease = await transaction.execute<{ user_id: string }>(sql`
        UPDATE native_live_runtime_listener_leases
        SET lease_expires_at =
              now() + ${LISTENER_LEASE_MS} * interval '1 millisecond',
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND dispatch_target = 'claude_code'
          AND listener_instance_id = ${input.listenerInstanceId}::uuid
          AND lease_expires_at > now()
        RETURNING user_id
      `);
      if (lease.length !== 1) {
        throw new NativeLiveBackendRelayError(
          "LISTENER_NOT_ACTIVE",
          "Native live relay listener lease is not active.",
        );
      }

      await transaction.execute(sql`
        UPDATE native_live_turn_preparations
        SET dispatch_status = 'delivery_unknown',
            delivery_unknown_at = COALESCE(delivery_unknown_at, now()),
            dispatch_error_code = 'RESERVATION_EXPIRED_AFTER_EXECUTION'
        WHERE user_id = ${input.userId}::uuid
          AND dispatch_status IN ('reserved', 'executing')
          AND reservation_expires_at <= now()
          AND execution_started_at IS NOT NULL
      `);

      await transaction.execute(sql`
        UPDATE native_live_turn_preparations
        SET dispatch_status = 'pending',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            execution_started_at = NULL,
            dispatch_error_code = 'RESERVATION_EXPIRED_BEFORE_EXECUTION'
        WHERE user_id = ${input.userId}::uuid
          AND dispatch_status = 'reserved'
          AND reservation_expires_at <= now()
          AND execution_started_at IS NULL
      `);

      await transaction.execute(sql`
        UPDATE native_live_turn_preparations
        SET dispatch_status = 'rejected',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            execution_started_at = NULL,
            dispatch_error_code = COALESCE(
              dispatch_error_code,
              'RESULT_DELIVERY_UNKNOWN'
            ),
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'prepared'
          AND dispatch_status = 'delivery_unknown'
          AND delivery_unknown_at IS NOT NULL
          AND delivery_unknown_at <= now() - interval '30 seconds'
      `);

      await transaction.execute(sql`
        UPDATE native_live_turn_preparations AS older
        SET dispatch_status = 'rejected',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            execution_started_at = NULL,
            dispatch_error_code = 'SUPERSEDED_BY_NEWER_TURN',
            updated_at = now()
        WHERE older.user_id = ${input.userId}::uuid
          AND older.status = 'prepared'
          AND older.dispatch_status = 'pending'
          AND EXISTS (
            SELECT 1
            FROM native_live_turn_preparations AS newer
            WHERE newer.user_id = older.user_id
              AND newer.conversation_id = older.conversation_id
              AND newer.status = 'prepared'
              AND newer.dispatch_status IN (
                'staged',
                'pending',
                'reserved',
                'executing',
                'delivery_unknown'
              )
              AND (
                newer.created_at > older.created_at
                OR (
                  newer.created_at = older.created_at
                  AND newer.id > older.id
                )
              )
          )
      `);

      // Foreground user intent always wins over a silence opportunity,
      // including a cross-conversation race between /fire and a new send.
      // A staged row that predates the assistant head which created this wake
      // is stranded historical work, not current foreground intent.
      await transaction.execute(sql`
        UPDATE native_live_turn_preparations AS wake
        SET dispatch_status = 'rejected',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            execution_started_at = NULL,
            dispatch_error_code = 'SUPERSEDED_BY_NEWER_TURN',
            updated_at = now()
        WHERE wake.user_id = ${input.userId}::uuid
          AND wake.operation = 'wake'
          AND wake.status = 'prepared'
          AND wake.dispatch_status = 'pending'
          AND EXISTS (
            SELECT 1
            FROM native_live_turn_preparations AS foreground
            WHERE foreground.user_id = wake.user_id
              AND foreground.operation <> 'wake'
              AND foreground.status = 'prepared'
              AND (
                foreground.dispatch_status IN (
                  'pending',
                  'reserved',
                  'executing',
                  'delivery_unknown'
                )
                OR (
                  foreground.dispatch_status = 'staged'
                  AND EXISTS (
                    SELECT 1
                    FROM conversation_messages AS wake_source
                    WHERE wake_source.user_id = wake.user_id
                      AND wake_source.conversation_id =
                        wake.conversation_id
                      AND wake_source.id =
                        (wake.wake_context ->> 'source_head_message_id')::uuid
                      AND wake_source.completed_at IS NOT NULL
                      AND foreground.created_at >=
                        wake_source.completed_at
                  )
                )
              )
          )
      `);

      await transaction.execute(sql`
        DELETE FROM native_live_turn_preparations
        WHERE user_id = ${input.userId}::uuid
          AND operation = 'wake'
          AND status = 'prepared'
          AND dispatch_status = 'rejected'
          AND dispatch_error_code = 'SUPERSEDED_BY_NEWER_TURN'
      `);

      const reserved = await transaction.execute<{ id: string }>(sql`
        WITH candidate AS (
          SELECT id
          FROM native_live_turn_preparations
          WHERE user_id = ${input.userId}::uuid
            AND status = 'prepared'
            AND dispatch_status = 'pending'
          ORDER BY (operation = 'wake') ASC, created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE native_live_turn_preparations AS preparation
        SET dispatch_status = 'reserved',
            reserved_by = ${input.listenerInstanceId}::uuid,
            reserved_at = now(),
            reservation_expires_at =
              now() + ${RESERVATION_LEASE_MS} * interval '1 millisecond',
            execution_started_at = NULL,
            delivery_unknown_at = NULL,
            dispatch_error_code = NULL,
            updated_at = now()
        FROM candidate
        WHERE preparation.id = candidate.id
          AND preparation.user_id = ${input.userId}::uuid
          AND preparation.dispatch_status = 'pending'
        RETURNING preparation.id
      `);

      if (!reserved[0]) return null;
      const row = await this.findPreparation(
        transaction as Transaction,
        input.userId,
        reserved[0].id,
      );
      return row;
    });
  }

  async markExecutionStarted(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<RelayMutationOutcome> {
    const [current] = await this.db
      .select({
        status: nativeLiveTurnPreparations.dispatchStatus,
        reservedBy: nativeLiveTurnPreparations.reservedBy,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.reservationId),
        ),
      )
      .limit(1);

    if (!current) return "not_found";
    if (
      current.reservedBy === input.listenerInstanceId
      && current.status === "executing"
    ) {
      return "idempotent";
    }
    if (
      current.reservedBy !== input.listenerInstanceId
      || current.status !== "reserved"
    ) {
      return "conflict";
    }

    const updated = await this.db
      .update(nativeLiveTurnPreparations)
      .set({
        dispatchStatus: "executing",
        executionStartedAt: sql`now()`,
        reservationExpiresAt:
          sql`now() + ${RESERVATION_LEASE_MS} * interval '1 millisecond'`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.reservationId),
          eq(
            nativeLiveTurnPreparations.reservedBy,
            input.listenerInstanceId,
          ),
          eq(nativeLiveTurnPreparations.dispatchStatus, "reserved"),
        ),
      )
      .returning({ id: nativeLiveTurnPreparations.id });

    return updated.length === 1 ? "applied" : "conflict";
  }

  async ownsSubmitReservation(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<boolean> {
    const [row] = await this.db
      .select({ id: nativeLiveTurnPreparations.id })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.reservationId),
          eq(
            nativeLiveTurnPreparations.reservedBy,
            input.listenerInstanceId,
          ),
          sql`${nativeLiveTurnPreparations.dispatchStatus} IN ('executing', 'delivery_unknown', 'completed')`,
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async isDiscardedWakeReservation(input: {
    userId: string;
    reservationId: string;
  }): Promise<boolean> {
    return hasDiscardedWakeReceipt(
      this.db,
      input.userId,
      input.reservationId,
    );
  }

  async markCompleted(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<RelayMutationOutcome> {
    const [current] = await this.db
      .select({
        status: nativeLiveTurnPreparations.dispatchStatus,
        reservedBy: nativeLiveTurnPreparations.reservedBy,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.reservationId),
        ),
      )
      .limit(1);

    if (!current) return "not_found";
    if (
      current.reservedBy === input.listenerInstanceId
      && current.status === "completed"
    ) {
      return "idempotent";
    }
    if (
      current.reservedBy !== input.listenerInstanceId
      || (
        current.status !== "executing"
        && current.status !== "delivery_unknown"
      )
    ) {
      return "conflict";
    }

    const updated = await this.db
      .update(nativeLiveTurnPreparations)
      .set({
        dispatchStatus: "completed",
        dispatchErrorCode: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.reservationId),
          eq(
            nativeLiveTurnPreparations.reservedBy,
            input.listenerInstanceId,
          ),
          sql`${nativeLiveTurnPreparations.dispatchStatus} IN ('executing', 'delivery_unknown')`,
        ),
      )
      .returning({ id: nativeLiveTurnPreparations.id });

    return updated.length === 1 ? "applied" : "conflict";
  }

  async markDeliveryUnknown(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<RelayMutationOutcome> {
    const [current] = await this.db
      .select({
        status: nativeLiveTurnPreparations.dispatchStatus,
        reservedBy: nativeLiveTurnPreparations.reservedBy,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.reservationId),
        ),
      )
      .limit(1);

    if (!current) return "not_found";
    if (
      current.reservedBy === input.listenerInstanceId
      && (
        current.status === "delivery_unknown"
        || current.status === "completed"
      )
    ) {
      return "idempotent";
    }
    if (
      current.reservedBy !== input.listenerInstanceId
      || current.status !== "executing"
    ) {
      return "conflict";
    }

    const updated = await this.db
      .update(nativeLiveTurnPreparations)
      .set({
        dispatchStatus: "delivery_unknown",
        deliveryUnknownAt: sql`COALESCE(${nativeLiveTurnPreparations.deliveryUnknownAt}, now())`,
        dispatchErrorCode: "RESULT_DELIVERY_UNKNOWN",
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.reservationId),
          eq(
            nativeLiveTurnPreparations.reservedBy,
            input.listenerInstanceId,
          ),
          eq(nativeLiveTurnPreparations.dispatchStatus, "executing"),
        ),
      )
      .returning({ id: nativeLiveTurnPreparations.id });

    return updated.length === 1 ? "applied" : "conflict";
  }

  async rejectReservation(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    code: NativeLiveDaemonRejectCode;
  }): Promise<RelayMutationOutcome> {
    const nextStatus =
      input.code === "EXECUTION_START_FAILED" ? "pending" : "rejected";

    const updated = await this.db
      .update(nativeLiveTurnPreparations)
      .set({
        dispatchStatus: nextStatus,
        reservedBy: null,
        reservedAt: null,
        reservationExpiresAt: null,
        executionStartedAt: null,
        dispatchErrorCode: input.code,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.reservationId),
          eq(
            nativeLiveTurnPreparations.reservedBy,
            input.listenerInstanceId,
          ),
          sql`${nativeLiveTurnPreparations.dispatchStatus} IN ('reserved', 'executing')`,
        ),
      )
      .returning({ id: nativeLiveTurnPreparations.id });

    if (updated.length === 1) return "applied";

    const [current] = await this.db
      .select({
        status: nativeLiveTurnPreparations.dispatchStatus,
        reservedBy: nativeLiveTurnPreparations.reservedBy,
      })
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, input.userId),
          eq(nativeLiveTurnPreparations.id, input.reservationId),
        ),
      )
      .limit(1);

    if (!current) return "not_found";
    if (
      current.status === nextStatus
      && (
        nextStatus === "pending"
        || current.reservedBy === null
      )
    ) {
      return "idempotent";
    }
    return "conflict";
  }

  private async findPreparation(
    executor: Transaction,
    userId: string,
    prepareId: string,
  ): Promise<RelayPreparationRow | null> {
    const [row] = await executor
      .select(preparationSelection)
      .from(nativeLiveTurnPreparations)
      .where(
        and(
          eq(nativeLiveTurnPreparations.userId, userId),
          eq(nativeLiveTurnPreparations.id, prepareId),
        ),
      )
      .limit(1);
    return row ? mapPreparation(row) : null;
  }
}

function isAcceptedTerminalFinalize(
  result: NativeLiveFinalizeResult,
): boolean {
  if (result.ok) return true;
  return (
    result.code === "CLAUDE_PROCESS_FAILED"
    || result.code === "MALFORMED_STREAM"
    || result.code === "ABORTED"
    || result.code === "INTERRUPTED"
    || result.code === "NO_PROVIDER_SESSION"
    || result.code === "PROVIDER_SESSION_CONFLICT"
    || result.code === "WORKING_DIRECTORY_UNAVAILABLE"
    || result.code === "WORKING_DIRECTORY_MISMATCH"
    || result.code === "RUNTIME_UNAVAILABLE"
    || result.code === "RUNTIME_PROTOCOL_ERROR"
  );
}

export class NativeLiveBackendRelayService {
  constructor(
    private readonly repository: NativeLiveBackendRelayPort,
    private readonly coordinator: Pick<
      NativeLiveBackendTurnCoordinator,
      "finalize"
    >,
    private readonly workWake?: {
      notify(input:
        | {
            userId: string;
            kind: "foreground";
          }
        | {
            userId: string;
            kind: "turn_terminal";
            prepareId: string;
          }
      ): Promise<void>;
    },
    private readonly runtimeProtocolVersion: 4 = 4,
    private readonly outputAttachmentsEnabled = true,
  ) {}

  async enqueuePreparation(input: {
    userId: string;
    prepareId: string;
  }): Promise<void> {
    const outcome = await this.repository.enqueuePreparation(input);
    this.requireMutation(outcome);
    await this.bestEffortWake(input.userId, "foreground");
  }

  async renewLease(input: {
    userId: string;
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveDaemonLeaseState> {
    const state = await this.repository.renewLease({
      userId: input.userId,
      listenerInstanceId: input.listenerInstanceId,
    });
    if (state === "busy") {
      return "busy";
    }
    return state;
  }

  async reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
    dispatchTarget: "claude_code";
  }): Promise<NativeLiveDaemonReservation | null> {
    const preparation = await this.repository.reserveNext({
      userId: input.userId,
      listenerInstanceId: input.listenerInstanceId,
    });
    if (!preparation) return null;
    return {
      reservationId: preparation.prepareId,
      command: nativeLiveRuntimeCommandFromPreparation(
        preparation,
        this.runtimeProtocolVersion,
        this.outputAttachmentsEnabled,
      ),
    };
  }

  async markExecutionStarted(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<void> {
    const outcome = await this.repository.markExecutionStarted(input);
    this.requireMutation(outcome);
  }

  async submitResult(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    result: NativeLiveRuntimeExecutionResult;
  }): Promise<NativeLiveFinalizeResult> {
    if (input.result.prepare_id !== input.reservationId) {
      throw new NativeLiveBackendRelayError(
        "RESERVATION_CONFLICT",
        "Native live result reservation identity does not match.",
      );
    }
    const owned = await this.repository.ownsSubmitReservation(input);
    if (!owned) {
      const discarded =
        await this.repository.isDiscardedWakeReservation?.({
          userId: input.userId,
          reservationId: input.reservationId,
        }) ?? false;
      if (discarded) {
        return {
          ok: true,
          outcome: "wake_discarded",
          requestId: input.result.request_id,
          operation: "wake",
          conversationId: input.result.conversation_id,
          providerSessionId:
            input.result.status === "success"
              ? input.result.provider_session_id
              : null,
        };
      }
      throw new NativeLiveBackendRelayError(
        "RESERVATION_CONFLICT",
        "Native live result does not belong to the active reservation.",
      );
    }

    const finalized = await this.coordinator.finalize(
      input.userId,
      input.result,
    );
    if (
      !finalized.ok
      && !isAcceptedTerminalFinalize(finalized)
    ) {
      throw new NativeLiveBackendRelayError(
        "FINALIZE_REJECTED",
        "Native live backend rejected the runtime result.",
        finalized.code,
      );
    }

    if (
      !finalized.ok
      || !(
        finalized.outcome === "wake_quiet"
        || finalized.outcome === "wake_stale"
        || finalized.outcome === "wake_failed"
        || finalized.outcome === "wake_discarded"
      )
    ) {
      const outcome = await this.repository.markCompleted(input);
      this.requireMutation(outcome);
    }
    await this.bestEffortTurnTerminalWake(
      input.userId,
      input.reservationId,
    );
    return finalized;
  }

  async markResultDeliveryUnknown(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
  }): Promise<void> {
    const outcome = await this.repository.markDeliveryUnknown(input);
    this.requireMutation(outcome);
  }

  async rejectReservation(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    code: NativeLiveDaemonRejectCode;
  }): Promise<void> {
    const outcome = await this.repository.rejectReservation(input);
    this.requireMutation(outcome);
    await this.bestEffortTurnTerminalWake(
      input.userId,
      input.reservationId,
    );
  }

  private async bestEffortWake(
    userId: string,
    kind: "foreground",
  ): Promise<void> {
    try {
      await this.workWake?.notify({ userId, kind });
    } catch {
      // Durable queue state is authoritative; wake delivery is advisory.
    }
  }

  private async bestEffortTurnTerminalWake(
    userId: string,
    prepareId: string,
  ): Promise<void> {
    try {
      await this.workWake?.notify({
        userId,
        kind: "turn_terminal",
        prepareId,
      });
    } catch {
      // Durable terminal turn state is authoritative.
    }
  }

  private requireMutation(outcome: RelayMutationOutcome): void {
    if (outcome === "applied" || outcome === "idempotent") return;
    throw new NativeLiveBackendRelayError(
      outcome === "not_found"
        ? "RESERVATION_CONFLICT"
        : "RESERVATION_CONFLICT",
      "Native live relay reservation is no longer valid.",
    );
  }
}
