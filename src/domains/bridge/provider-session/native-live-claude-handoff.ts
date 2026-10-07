import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;
type DbExecutor = Database | Transaction;

const REQUEST_TTL_MS = 60_000;
const RESERVATION_TTL_MS = 120_000;

export type NativeLiveClaudeHandoffStatus =
  | "pending"
  | "reserved"
  | "delivery_unknown"
  | "completed"
  | "failed"
  | "stale"
  | "expired";

export type NativeLiveClaudeHandoffReadModel = {
  id: string;
  conversationId: string;
  status: NativeLiveClaudeHandoffStatus;
  handoffSessionId: string | null;
  effectiveWorkingDirectory: string;
  failureCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type NativeLiveClaudeHandoffReservation = {
  reservationId: string;
  conversationId: string;
  expectedHeadMessageId: string;
  sourceMessageId: string;
  providerSessionId: string;
  providerCheckpointId: string;
  effectiveWorkingDirectory: string;
};

export type NativeLiveClaudeHandoffCompletion =
  | {
      status: "success";
      handoffSessionId: string;
    }
  | {
      status: "failure";
      failureCode: string;
    };

export class NativeLiveClaudeHandoffError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "NO_RUNTIME_SESSION"
      | "CONVERSATION_BUSY"
      | "HANDOFF_ALREADY_PENDING"
      | "RUNTIME_OFFLINE"
      | "LISTENER_NOT_ACTIVE"
      | "RESERVATION_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveClaudeHandoffError";
  }
}

export class NativeLiveClaudeHandoffService {
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
  }): Promise<NativeLiveClaudeHandoffReadModel> {
    const brokerListenerOnline =
      await this.runtimePresence
        ?.isListenerOnline()
        .catch(() => false)
      ?? false;

    const created = await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE native_live_claude_handoffs
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
        FROM native_live_claude_handoffs
        WHERE user_id = ${input.userId}::uuid
          AND conversation_id = ${input.conversationId}::uuid
          AND status IN ('pending','reserved','delivery_unknown')
        LIMIT 1
      `);
      if (active[0]) {
        throw new NativeLiveClaudeHandoffError(
          "HANDOFF_ALREADY_PENDING",
          "A Claude Code handoff is already in progress for this conversation.",
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
        throw new NativeLiveClaudeHandoffError(
          "RUNTIME_OFFLINE",
          "The Mac runtime is not currently online.",
        );
      }

      if (await hasInFlightTurn(tx, input)) {
        throw new NativeLiveClaudeHandoffError(
          "CONVERSATION_BUSY",
          "Wait for the current turn to finish before continuing in Claude Code.",
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
        throw new NativeLiveClaudeHandoffError(
          "NOT_FOUND",
          "Native live conversation was not found.",
        );
      }
      if (!conversation.current_head_message_id) {
        throw new NativeLiveClaudeHandoffError(
          "NO_RUNTIME_SESSION",
          "This conversation does not have a Claude checkpoint to hand off yet.",
        );
      }

      const checkpoints = await tx.execute<{
        source_message_id: string;
        provider_session_id: string;
        provider_checkpoint_id: string;
        effective_working_directory: string;
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
          checkpoint.provider_checkpoint_id,
          checkpoint.effective_working_directory
        FROM current_path AS path
        INNER JOIN conversation_provider_session_checkpoints AS checkpoint
          ON checkpoint.canonical_message_id = path.id
         AND checkpoint.user_id = ${input.userId}::uuid
         AND checkpoint.conversation_id =
           ${input.conversationId}::uuid
         AND checkpoint.provider = 'claude_code'
         AND checkpoint.provider_checkpoint_id IS NOT NULL
         AND checkpoint.effective_working_directory IS NOT NULL
         AND char_length(btrim(checkpoint.effective_working_directory)) > 0
        ORDER BY path.depth ASC
        LIMIT 1
      `);
      const checkpoint = checkpoints[0];
      if (!checkpoint) {
        throw new NativeLiveClaudeHandoffError(
          "NO_RUNTIME_SESSION",
          "This conversation does not have a Claude checkpoint to hand off yet.",
        );
      }

      const rows = await tx.execute<ReadRow>(sql`
        INSERT INTO native_live_claude_handoffs (
          user_id,
          conversation_id,
          expected_head_message_id,
          source_message_id,
          provider_session_id,
          provider_checkpoint_id,
          effective_working_directory,
          expires_at
        ) VALUES (
          ${input.userId}::uuid,
          ${input.conversationId}::uuid,
          ${conversation.current_head_message_id}::uuid,
          ${checkpoint.source_message_id}::uuid,
          ${checkpoint.provider_session_id},
          ${checkpoint.provider_checkpoint_id},
          ${checkpoint.effective_working_directory},
          now() + ${REQUEST_TTL_MS} * interval '1 millisecond'
        )
        RETURNING
          id,
          conversation_id,
          status,
          handoff_session_id,
          effective_working_directory,
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
  }): Promise<NativeLiveClaudeHandoffReadModel | null> {
    await this.db.execute(sql`
      UPDATE native_live_claude_handoffs
      SET status = 'expired',
          failure_code = 'REQUEST_EXPIRED',
          completed_at = now(),
          updated_at = now()
      WHERE id = ${input.requestId}::uuid
        AND user_id = ${input.userId}::uuid
        AND status = 'pending'
        AND expires_at <= now()
    `);

    const rows = await this.db.execute<ReadRow>(sql`
      SELECT
        id,
        conversation_id,
        status,
        handoff_session_id,
        effective_working_directory,
        failure_code,
        created_at::text,
        completed_at::text
      FROM native_live_claude_handoffs
      WHERE id = ${input.requestId}::uuid
        AND user_id = ${input.userId}::uuid
      LIMIT 1
    `);
    return rows[0] ? readModel(rows[0]) : null;
  }

  async reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveClaudeHandoffReservation | null> {
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
        throw new NativeLiveClaudeHandoffError(
          "LISTENER_NOT_ACTIVE",
          "Native live listener lease is not active.",
        );
      }

      await tx.execute(sql`
        UPDATE native_live_claude_handoffs
        SET status = 'delivery_unknown',
            failure_code = 'RESULT_DELIVERY_UNKNOWN',
            reservation_expires_at = NULL,
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'reserved'
          AND reservation_expires_at <= now()
      `);

      await tx.execute(sql`
        UPDATE native_live_claude_handoffs
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
        provider_checkpoint_id: string;
        effective_working_directory: string;
      }>(sql`
        WITH candidate AS (
          SELECT id
          FROM native_live_claude_handoffs
          WHERE user_id = ${input.userId}::uuid
            AND status = 'pending'
            AND expires_at > now()
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE native_live_claude_handoffs AS request
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
          request.provider_checkpoint_id,
          request.effective_working_directory
      `);

      const row = rows[0];
      return row
        ? {
            reservationId: row.id,
            conversationId: row.conversation_id,
            expectedHeadMessageId: row.expected_head_message_id,
            sourceMessageId: row.source_message_id,
            providerSessionId: row.provider_session_id,
            providerCheckpointId: row.provider_checkpoint_id,
            effectiveWorkingDirectory:
              row.effective_working_directory,
          }
        : null;
    });
  }

  async complete(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    outcome: NativeLiveClaudeHandoffCompletion;
  }): Promise<"completed" | "failed" | "stale"> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        conversation_id: string;
        expected_head_message_id: string;
        source_message_id: string;
        provider_session_id: string;
        provider_checkpoint_id: string;
        status: NativeLiveClaudeHandoffStatus;
        handoff_session_id: string | null;
        failure_code: string | null;
        reserved_by: string | null;
      }>(sql`
        SELECT
          conversation_id,
          expected_head_message_id,
          source_message_id,
          provider_session_id,
          provider_checkpoint_id,
          status,
          handoff_session_id,
          failure_code,
          reserved_by
        FROM native_live_claude_handoffs
        WHERE id = ${input.reservationId}::uuid
          AND user_id = ${input.userId}::uuid
        FOR UPDATE
        LIMIT 1
      `);
      const current = rows[0];
      if (
        current
        && input.outcome.status === "success"
        && current.status === "delivery_unknown"
        && current.failure_code === "RESULT_DELIVERY_UNKNOWN"
        && current.reserved_by === input.listenerInstanceId
      ) {
        await tx.execute(sql`
          UPDATE native_live_claude_handoffs
          SET status = 'reserved',
              completed_at = NULL,
              updated_at = now()
          WHERE id = ${input.reservationId}::uuid
            AND user_id = ${input.userId}::uuid
        `);
        current.status = "reserved";
      }

      if (
        current
        && input.outcome.status === "success"
        && current.handoff_session_id
          === input.outcome.handoffSessionId.trim()
      ) {
        if (current.status === "completed") {
          return "completed" as const;
        }
        if (current.status === "stale") {
          return "stale" as const;
        }
      }
      if (
        current
        && input.outcome.status === "failure"
        && current.status === "failed"
      ) {
        return "failed" as const;
      }
      if (
        !current
        || current.status !== "reserved"
        || current.reserved_by !== input.listenerInstanceId
      ) {
        throw new NativeLiveClaudeHandoffError(
          "RESERVATION_CONFLICT",
          "Claude handoff reservation is no longer valid.",
        );
      }

      if (input.outcome.status === "failure") {
        await tx.execute(sql`
          UPDATE native_live_claude_handoffs
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

      const handoffSessionId =
        input.outcome.handoffSessionId.trim();
      if (
        !handoffSessionId
        || handoffSessionId === current.provider_session_id
      ) {
        throw new NativeLiveClaudeHandoffError(
          "RESERVATION_CONFLICT",
          "Claude handoff did not create an isolated provider session.",
        );
      }

      const conversations = await tx.execute<{
        lifecycle_status: string;
        current_head_message_id: string | null;
      }>(sql`
        SELECT lifecycle_status, current_head_message_id
        FROM conversations
        WHERE id = ${current.conversation_id}::uuid
          AND user_id = ${input.userId}::uuid
          AND origin = 'native_live'
        FOR UPDATE
        LIMIT 1
      `);
      const conversation = conversations[0];
      if (
        !conversation
        || conversation.lifecycle_status !== "active"
        || conversation.current_head_message_id
          !== current.expected_head_message_id
      ) {
        await markStale(tx, input, handoffSessionId, "STALE_HEAD");
        return "stale";
      }

      if (await hasInFlightTurn(tx, {
        userId: input.userId,
        conversationId: current.conversation_id,
      })) {
        await markStale(
          tx,
          input,
          handoffSessionId,
          "CONVERSATION_BUSY",
        );
        return "stale";
      }

      const checkpoints = await tx.execute<{ ok: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM conversation_provider_session_checkpoints
          WHERE user_id = ${input.userId}::uuid
            AND conversation_id =
              ${current.conversation_id}::uuid
            AND canonical_message_id =
              ${current.source_message_id}::uuid
            AND provider = 'claude_code'
            AND provider_session_id =
              ${current.provider_session_id}
            AND provider_checkpoint_id =
              ${current.provider_checkpoint_id}
        ) AS ok
      `);
      if (!checkpoints[0]?.ok) {
        await markStale(
          tx,
          input,
          handoffSessionId,
          "STALE_CHECKPOINT",
        );
        return "stale";
      }

      const handoffAt = new Date().toISOString();
      const archived = await tx.execute<{ id: string }>(sql`
        UPDATE conversations
        SET lifecycle_status = 'archived',
            archived_at = now(),
            deleted_at = NULL,
            provider_metadata =
              COALESCE(provider_metadata, '{}'::jsonb)
              || ${JSON.stringify({
                claude_handoff: {
                  session_id: handoffSessionId,
                  handed_off_at: handoffAt,
                },
              })}::jsonb,
            updated_at = now()
        WHERE id = ${current.conversation_id}::uuid
          AND user_id = ${input.userId}::uuid
          AND origin = 'native_live'
          AND lifecycle_status = 'active'
          AND current_head_message_id =
              ${current.expected_head_message_id}::uuid
        RETURNING id
      `);
      if (archived.length !== 1) {
        await markStale(tx, input, handoffSessionId, "STALE_HEAD");
        return "stale";
      }

      await tx.execute(sql`
        UPDATE native_live_claude_handoffs
        SET status = 'completed',
            handoff_session_id = ${handoffSessionId},
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

type ReadRow = {
  id: string;
  conversation_id: string;
  status: NativeLiveClaudeHandoffStatus;
  handoff_session_id: string | null;
  effective_working_directory: string;
  failure_code: string | null;
  created_at: string;
  completed_at: string | null;
};

function readModel(row: ReadRow): NativeLiveClaudeHandoffReadModel {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    handoffSessionId: row.handoff_session_id,
    effectiveWorkingDirectory:
      row.effective_working_directory,
    failureCode: row.failure_code,
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
  };
}

async function hasInFlightTurn(
  tx: DbExecutor,
  input: {
    userId: string;
    conversationId: string;
  },
): Promise<boolean> {
  const rows = await tx.execute<{ busy: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM native_live_turn_preparations
      WHERE user_id = ${input.userId}::uuid
        AND conversation_id = ${input.conversationId}::uuid
        AND status = 'prepared'
        AND dispatch_status IN (
          'staged','pending','reserved','executing',
          'delivery_unknown'
        )
    ) AS busy
  `);
  return Boolean(rows[0]?.busy);
}

async function markStale(
  tx: SqlExecutor,
  input: {
    userId: string;
    reservationId: string;
  },
  handoffSessionId: string,
  failureCode: string,
): Promise<void> {
  await tx.execute(sql`
    UPDATE native_live_claude_handoffs
    SET status = 'stale',
        handoff_session_id = ${handoffSessionId},
        failure_code = ${failureCode},
        reserved_by = NULL,
        reserved_at = NULL,
        reservation_expires_at = NULL,
        completed_at = now(),
        updated_at = now()
    WHERE id = ${input.reservationId}::uuid
      AND user_id = ${input.userId}::uuid
  `);
}

function normalizeFailureCode(value: string): string {
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 64) : "HANDOFF_FAILED";
}
