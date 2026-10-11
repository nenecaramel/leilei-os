import { sql } from "drizzle-orm";
import { nativeSessionHeldByDesktop } from "../../conversation/native-live-conversation-repository.js";
import type { createDatabase } from "../../../database/client.js";
import type {
  NativeLiveRuntimeContextUsage,
} from "../protocol/native-live-runtime-protocol.js";

type Database = ReturnType<typeof createDatabase>["db"];

const REQUEST_TTL_MS = 30_000;
const RESERVATION_TTL_MS = 60_000;

export type NativeLiveManualCompactStatus =
  | "pending"
  | "reserved"
  | "completed"
  | "failed"
  | "stale"
  | "expired";

export type NativeLiveManualCompactReadModel = {
  id: string;
  conversationId: string;
  status: NativeLiveManualCompactStatus;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type NativeLiveManualCompactReservation = {
  reservationId: string;
  conversationId: string;
  expectedHeadMessageId: string;
  sourceMessageId: string;
  providerSessionId: string;
  effectiveWorkingDirectory: string | null;
  providerCheckpointId?: string | null;
};

export type NativeLiveManualCompactSuccess = {
  providerSessionId: string;
  providerCheckpointId?: string | null;
  contextUsage: NativeLiveRuntimeContextUsage | null;
  boundary: Record<string, unknown> | null;
  summary: string | null;
};

export type NativeLiveManualCompactCompletion =
  | {
      status: "success";
      result: NativeLiveManualCompactSuccess;
    }
  | {
      status: "failure";
      failureCode: string;
    };

export class NativeLiveManualCompactError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "NO_RUNTIME_SESSION"
      | "CONVERSATION_BUSY"
      | "COMPACT_ALREADY_PENDING"
      | "RUNTIME_OFFLINE"
      | "LISTENER_NOT_ACTIVE"
      | "RESERVATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveManualCompactError";
  }
}

export class NativeLiveManualCompactService {
  constructor(
    private readonly db: Database,
    private readonly wake?: {
      notify(input: {
        userId: string;
        kind: "foreground";
      }): Promise<void>;
    },
    private readonly runtimePresence?: {
      isListenerOnline(): Promise<boolean>;
    },
  ) {}

  async create(input: {
    userId: string;
    conversationId: string;
  }): Promise<NativeLiveManualCompactReadModel> {
    const brokerListenerOnline =
      await this.runtimePresence
        ?.isListenerOnline()
        .catch(() => false)
      ?? false;
    const created = await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE native_live_manual_compactions
        SET status = 'expired',
            failure_code = 'REQUEST_EXPIRED',
            completed_at = now(),
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND conversation_id = ${input.conversationId}::uuid
          AND status = 'pending'
          AND expires_at <= now()
      `);

      const active = await tx.execute<{ id: string }>(sql`
        SELECT id
        FROM native_live_manual_compactions
        WHERE user_id = ${input.userId}::uuid
          AND conversation_id = ${input.conversationId}::uuid
          AND status IN ('pending','reserved')
        LIMIT 1
      `);
      if (active[0]) {
        throw new NativeLiveManualCompactError(
          "COMPACT_ALREADY_PENDING",
          "A manual compact is already in progress for this conversation.",
        );
      }

      const listener = await tx.execute<{ ok: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM native_live_runtime_listener_leases
          WHERE user_id = ${input.userId}::uuid
            AND dispatch_target = 'claude_code'
            AND lease_expires_at > now()
        ) AS ok
      `);
      if (!listener[0]?.ok && !brokerListenerOnline) {
        throw new NativeLiveManualCompactError(
          "RUNTIME_OFFLINE",
          "The Mac runtime is not currently online.",
        );
      }

      const busy = await tx.execute<{ busy: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM native_live_turn_preparations
          WHERE user_id = ${input.userId}::uuid
            AND conversation_id = ${input.conversationId}::uuid
            AND status = 'prepared'
            AND dispatch_status IN (
              'staged','pending','reserved','executing'
            )
        ) AS busy
      `);
      if (busy[0]?.busy) {
        throw new NativeLiveManualCompactError(
          "CONVERSATION_BUSY",
          "Wait for the current turn to finish before compacting context.",
        );
      }

      const conversations = await tx.execute<{
        id: string;
        current_head_message_id: string | null;
      }>(sql`
        SELECT id, current_head_message_id
        FROM conversations
        WHERE id = ${input.conversationId}::uuid
          AND user_id = ${input.userId}::uuid
          AND origin = 'native_live'
          AND lifecycle_status = 'active'
        FOR UPDATE
        LIMIT 1
      `);
      const conversation = conversations[0];
      if (!conversation) {
        throw new NativeLiveManualCompactError(
          "NOT_FOUND",
          "Native live conversation was not found.",
        );
      }
      if (await nativeSessionHeldByDesktop(tx, input)) {
        throw new NativeLiveManualCompactError("CONVERSATION_BUSY", "This native session is currently held by Desktop.");
      }
      if (!conversation.current_head_message_id) {
        throw new NativeLiveManualCompactError(
          "NO_RUNTIME_SESSION",
          "This conversation does not have a provider session to compact yet.",
        );
      }

      const checkpoints = await tx.execute<{
        source_message_id: string;
        provider_session_id: string;
        effective_working_directory: string | null;
      }>(sql`
        WITH RECURSIVE current_path AS (
          SELECT
            message.id,
            message.parent_message_id,
            0 AS depth
          FROM conversation_messages AS message
          WHERE message.id =
              ${conversation.current_head_message_id}::uuid
            AND message.user_id = ${input.userId}::uuid
            AND message.conversation_id =
              ${input.conversationId}::uuid

          UNION ALL

          SELECT
            parent.id,
            parent.parent_message_id,
            path.depth + 1
          FROM conversation_messages AS parent
          JOIN current_path AS path
            ON parent.id = path.parent_message_id
          WHERE parent.user_id = ${input.userId}::uuid
            AND parent.conversation_id =
              ${input.conversationId}::uuid
        )
        SELECT
          checkpoint.canonical_message_id AS source_message_id,
          checkpoint.provider_session_id,
          checkpoint.effective_working_directory
        FROM current_path AS path
        INNER JOIN conversation_provider_session_checkpoints AS checkpoint
          ON checkpoint.canonical_message_id = path.id
         AND checkpoint.user_id = ${input.userId}::uuid
         AND checkpoint.conversation_id =
           ${input.conversationId}::uuid
         AND checkpoint.provider = 'claude_code'
        ORDER BY path.depth ASC
        LIMIT 1
      `);
      const checkpoint = checkpoints[0];
      if (!checkpoint) {
        throw new NativeLiveManualCompactError(
          "NO_RUNTIME_SESSION",
          "This conversation does not have a provider session to compact yet.",
        );
      }

      const rows = await tx.execute<{
        id: string;
        conversation_id: string;
        status: NativeLiveManualCompactStatus;
        failure_code: string | null;
        created_at: string;
        completed_at: string | null;
      }>(sql`
        INSERT INTO native_live_manual_compactions (
          user_id,
          conversation_id,
          expected_head_message_id,
          source_message_id,
          provider_session_id,
          effective_working_directory,
          expires_at
        ) VALUES (
          ${input.userId}::uuid,
          ${input.conversationId}::uuid,
          ${conversation.current_head_message_id}::uuid,
          ${checkpoint.source_message_id}::uuid,
          ${checkpoint.provider_session_id},
          ${checkpoint.effective_working_directory},
          now() + ${REQUEST_TTL_MS} * interval '1 millisecond'
        )
        RETURNING
          id,
          conversation_id,
          status,
          failure_code,
          created_at::text,
          completed_at::text
      `);
      return readModel(rows[0]!);
    });

    await this.wake?.notify({
      userId: input.userId,
      kind: "foreground",
    });
    return created;
  }

  async read(input: {
    userId: string;
    requestId: string;
  }): Promise<NativeLiveManualCompactReadModel | null> {
    await this.db.execute(sql`
      UPDATE native_live_manual_compactions
      SET status = 'expired',
          failure_code = 'REQUEST_EXPIRED',
          completed_at = now(),
          updated_at = now()
      WHERE id = ${input.requestId}::uuid
        AND user_id = ${input.userId}::uuid
        AND status = 'pending'
        AND expires_at <= now()
    `);

    const rows = await this.db.execute<{
      id: string;
      conversation_id: string;
      status: NativeLiveManualCompactStatus;
      failure_code: string | null;
      created_at: string;
      completed_at: string | null;
    }>(sql`
      SELECT
        id,
        conversation_id,
        status,
        failure_code,
        created_at::text,
        completed_at::text
      FROM native_live_manual_compactions
      WHERE id = ${input.requestId}::uuid
        AND user_id = ${input.userId}::uuid
      LIMIT 1
    `);
    return rows[0] ? readModel(rows[0]) : null;
  }

  async reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveManualCompactReservation | null> {
    return this.db.transaction(async (tx) => {
      const lease = await tx.execute<{ user_id: string }>(sql`
        UPDATE native_live_runtime_listener_leases
        SET lease_expires_at =
              now() + 60000 * interval '1 millisecond',
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND dispatch_target = 'claude_code'
          AND listener_instance_id =
            ${input.listenerInstanceId}::uuid
          AND lease_expires_at > now()
        RETURNING user_id
      `);
      if (lease.length !== 1) {
        throw new NativeLiveManualCompactError(
          "LISTENER_NOT_ACTIVE",
          "Native live listener lease is not active.",
        );
      }

      await tx.execute(sql`
        UPDATE native_live_manual_compactions
        SET status = 'failed',
            failure_code = 'RESULT_DELIVERY_UNKNOWN',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'reserved'
          AND reservation_expires_at <= now()
      `);

      await tx.execute(sql`
        UPDATE native_live_manual_compactions
        SET status = 'expired',
            failure_code = 'REQUEST_EXPIRED',
            completed_at = now(),
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'pending'
          AND expires_at <= now()
      `);

      const rows = await tx.execute<{
        id: string;
        conversation_id: string;
        expected_head_message_id: string;
        source_message_id: string;
        provider_session_id: string;
        effective_working_directory: string | null;
      }>(sql`
        WITH candidate AS (
          SELECT id
          FROM native_live_manual_compactions
          WHERE user_id = ${input.userId}::uuid
            AND status = 'pending'
            AND expires_at > now()
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE native_live_manual_compactions AS request
        SET status = 'reserved',
            reserved_by = ${input.listenerInstanceId}::uuid,
            reserved_at = now(),
            reservation_expires_at =
              now() + ${RESERVATION_TTL_MS}
                * interval '1 millisecond',
            updated_at = now()
        FROM candidate
        WHERE request.id = candidate.id
        RETURNING
          request.id,
          request.conversation_id,
          request.expected_head_message_id,
          request.source_message_id,
          request.provider_session_id,
          request.effective_working_directory
      `);
      const row = rows[0];
      const checkpoint = row ? await tx.execute<{ provider_checkpoint_id: string | null }>(sql`
        SELECT provider_checkpoint_id FROM conversation_provider_session_checkpoints
        WHERE user_id = ${input.userId}::uuid
          AND canonical_message_id = ${row.source_message_id}::uuid
          AND provider_session_id = ${row.provider_session_id}
          AND provider = 'claude_code'
      `) : [];
      return row
        ? {
            reservationId: row.id,
            conversationId: row.conversation_id,
            expectedHeadMessageId:
              row.expected_head_message_id,
            sourceMessageId: row.source_message_id,
            providerSessionId: row.provider_session_id,
            effectiveWorkingDirectory:
              row.effective_working_directory,
            providerCheckpointId: checkpoint[0]?.provider_checkpoint_id ?? null,
          }
        : null;
    });
  }

  async complete(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    outcome: NativeLiveManualCompactCompletion;
  }): Promise<"completed" | "failed" | "stale"> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        conversation_id: string;
        expected_head_message_id: string;
        source_message_id: string;
        provider_session_id: string;
        status: NativeLiveManualCompactStatus;
        reserved_by: string | null;
      }>(sql`
        SELECT
          conversation_id,
          expected_head_message_id,
          source_message_id,
          provider_session_id,
          status,
          reserved_by
        FROM native_live_manual_compactions
        WHERE id = ${input.reservationId}::uuid
          AND user_id = ${input.userId}::uuid
        FOR UPDATE
        LIMIT 1
      `);
      const current = rows[0];
      if (
        !current
        || current.status !== "reserved"
        || current.reserved_by !== input.listenerInstanceId
      ) {
        throw new NativeLiveManualCompactError(
          "RESERVATION_CONFLICT",
          "Manual compact reservation is no longer valid.",
        );
      }

      if (input.outcome.status === "failure") {
        await tx.execute(sql`
          UPDATE native_live_manual_compactions
          SET status = 'failed',
              failure_code =
                ${normalizeFailureCode(input.outcome.failureCode)},
              reserved_by = NULL,
              reserved_at = NULL,
              reservation_expires_at = NULL,
              completed_at = now(),
              updated_at = now()
          WHERE id = ${input.reservationId}::uuid
            AND user_id = ${input.userId}::uuid
        `);
        return "failed" as const;
      }

      if (
        input.outcome.result.providerSessionId
          !== current.provider_session_id
      ) {
        throw new NativeLiveManualCompactError(
          "RESERVATION_CONFLICT",
          "Manual compact changed provider session identity.",
        );
      }

      const headRows = await tx.execute<{
        current_head_message_id: string | null;
      }>(sql`
        SELECT current_head_message_id
        FROM conversations
        WHERE id = ${current.conversation_id}::uuid
          AND user_id = ${input.userId}::uuid
        FOR UPDATE
        LIMIT 1
      `);
      if (
        headRows[0]?.current_head_message_id
          !== current.expected_head_message_id
      ) {
        await tx.execute(sql`
          UPDATE native_live_manual_compactions
          SET status = 'stale',
              failure_code = 'STALE_HEAD',
              result =
                ${JSON.stringify(input.outcome.result)}::jsonb,
              reserved_by = NULL,
              reserved_at = NULL,
              reservation_expires_at = NULL,
              completed_at = now(),
              updated_at = now()
          WHERE id = ${input.reservationId}::uuid
            AND user_id = ${input.userId}::uuid
        `);
        return "stale" as const;
      }

      const checkpoint = await tx.execute<{ provider_checkpoint_id: string | null }>(sql`
        SELECT provider_checkpoint_id FROM conversation_provider_session_checkpoints
        WHERE user_id = ${input.userId}::uuid
          AND canonical_message_id = ${current.source_message_id}::uuid
          AND provider = 'claude_code'
          AND provider_session_id = ${current.provider_session_id}
        FOR UPDATE
      `);
      if (checkpoint[0]?.provider_checkpoint_id && !input.outcome.result.providerCheckpointId) {
        await tx.execute(sql`
          UPDATE native_live_manual_compactions
          SET status = 'failed', failure_code = 'NO_PROVIDER_SESSION',
              reserved_by = NULL, reserved_at = NULL, reservation_expires_at = NULL,
              completed_at = now(), updated_at = now()
          WHERE id = ${input.reservationId}::uuid AND user_id = ${input.userId}::uuid
        `);
        return "failed" as const;
      }

      const compactedAt = new Date().toISOString();
      const metadata = {
        ...(input.outcome.result.contextUsage
          ? {
              context_usage:
                input.outcome.result.contextUsage,
            }
          : {}),
        manual_compaction: {
          source: "manual",
          boundary: input.outcome.result.boundary,
          summary: input.outcome.result.summary,
          compacted_at: compactedAt,
        },
      };
      const updated = await tx.execute<{ id: string }>(sql`
        UPDATE conversation_provider_session_checkpoints
        SET provider_checkpoint_id = COALESCE(${input.outcome.result.providerCheckpointId ?? null}, provider_checkpoint_id),
          runtime_metadata =
          COALESCE(runtime_metadata, '{}'::jsonb)
          || ${JSON.stringify(metadata)}::jsonb
        WHERE user_id = ${input.userId}::uuid
          AND conversation_id =
            ${current.conversation_id}::uuid
          AND canonical_message_id =
            ${current.source_message_id}::uuid
          AND provider = 'claude_code'
          AND provider_session_id =
            ${current.provider_session_id}
        RETURNING id
      `);
      if (updated.length !== 1) {
        throw new NativeLiveManualCompactError(
          "RESERVATION_CONFLICT",
          "Manual compact checkpoint is no longer valid.",
        );
      }

      const lineage = await tx.execute<{ canonical_message_id: string }>(sql`
        WITH RECURSIVE current_path AS (
          SELECT
            message.id,
            message.parent_message_id,
            0 AS depth
          FROM conversation_messages AS message
          WHERE message.id = ${current.source_message_id}::uuid
            AND message.user_id = ${input.userId}::uuid
            AND message.conversation_id =
              ${current.conversation_id}::uuid

          UNION ALL

          SELECT
            parent.id,
            parent.parent_message_id,
            path.depth + 1
          FROM conversation_messages AS parent
          INNER JOIN current_path AS path
            ON parent.id = path.parent_message_id
          WHERE parent.user_id = ${input.userId}::uuid
            AND parent.conversation_id =
              ${current.conversation_id}::uuid
        ),
        nearest_lineage AS (
          SELECT
            lineage.epoch
          FROM current_path AS path
          INNER JOIN runtime_context_lineage_states AS lineage
            ON lineage.canonical_message_id = path.id
           AND lineage.user_id = ${input.userId}::uuid
           AND lineage.conversation_id =
             ${current.conversation_id}::uuid
          ORDER BY path.depth ASC
          LIMIT 1
        )
        INSERT INTO runtime_context_lineage_states (
          canonical_message_id,
          user_id,
          conversation_id,
          epoch,
          seen_state_ids
        )
        SELECT
          ${current.source_message_id}::uuid,
          ${input.userId}::uuid,
          ${current.conversation_id}::uuid,
          COALESCE(
            (SELECT epoch + 1 FROM nearest_lineage),
            1
          ),
          '[]'::jsonb
        ON CONFLICT (canonical_message_id)
        DO UPDATE SET
          epoch = runtime_context_lineage_states.epoch + 1,
          seen_state_ids = '[]'::jsonb,
          updated_at = now()
        WHERE runtime_context_lineage_states.user_id =
              ${input.userId}::uuid
          AND runtime_context_lineage_states.conversation_id =
              ${current.conversation_id}::uuid
        RETURNING canonical_message_id
      `);
      if (lineage.length !== 1) {
        throw new NativeLiveManualCompactError(
          "RESERVATION_CONFLICT",
          "Manual compact context lineage could not advance.",
        );
      }

      await tx.execute(sql`
        UPDATE native_live_manual_compactions
        SET status = 'completed',
            result =
              ${JSON.stringify(input.outcome.result)}::jsonb,
            failure_code = NULL,
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE id = ${input.reservationId}::uuid
          AND user_id = ${input.userId}::uuid
      `);
      return "completed" as const;
    });
  }
}

function readModel(row: {
  id: string;
  conversation_id: string;
  status: NativeLiveManualCompactStatus;
  failure_code: string | null;
  created_at: string;
  completed_at: string | null;
}): NativeLiveManualCompactReadModel {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    failureCode: row.failure_code,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
  };
}

function normalizeFailureCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized ? normalized.slice(0, 64) : "COMPACT_FAILED";
}
