import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";

type Database = ReturnType<typeof createDatabase>["db"];

const REQUEST_TTL_MS = 30_000;
const RESERVATION_TTL_MS = 60_000;

export type NativeLiveExternalSession = {
  sessionId: string;
  summary: string | null;
  customTitle: string | null;
  firstPrompt: string | null;
  gitBranch: string | null;
  lastModified: number | null;
  createdAt: number | null;
  workspaceId: string | null;
  workspaceRoot: string;
};

export type NativeLiveExternalSessionRequestStatus =
  | "pending"
  | "reserved"
  | "completed"
  | "failed"
  | "expired";

export type NativeLiveExternalSessionRequest = {
  id: string;
  status: NativeLiveExternalSessionRequestStatus;
  failureCode: string | null;
  sessions: NativeLiveExternalSession[];
  createdAt: string;
  completedAt: string | null;
};

export type NativeLiveExternalSessionReservation = {
  reservationId: string;
};

export type NativeLiveExternalSessionConversation = {
  id: string;
  title: string | null;
  currentHeadMessageId: null;
  lastMessageAt: null;
  createdAt: string;
  updatedAt: string;
};

export class NativeLiveExternalSessionBridgeError extends Error {
  constructor(
    readonly code:
      | "RUNTIME_OFFLINE"
      | "LISTENER_NOT_ACTIVE"
      | "RESERVATION_CONFLICT"
      | "REQUEST_NOT_FOUND"
      | "REQUEST_NOT_READY"
      | "SESSION_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveExternalSessionBridgeError";
  }
}

export class NativeLiveExternalSessionBridgeService {
  constructor(
    private readonly db: Database,
    private readonly wake?: {
      notify(input: {
        userId: string;
        kind: "foreground";
      }): Promise<void>;
    },
  ) {}

  async createListRequest(input: {
    userId: string;
  }): Promise<NativeLiveExternalSessionRequest> {
    const request = await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE native_live_external_session_requests
        SET status = 'expired',
            failure_code = 'REQUEST_EXPIRED',
            completed_at = now(),
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'pending'
          AND expires_at <= now()
      `);

      const listener = await tx.execute<{ ok: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM native_live_runtime_listener_leases
          WHERE user_id = ${input.userId}::uuid
            AND dispatch_target = 'claude_code'
            AND lease_expires_at > now()
        ) AS ok
      `);
      if (!listener[0]?.ok) {
        throw new NativeLiveExternalSessionBridgeError(
          "RUNTIME_OFFLINE",
          "The Mac runtime is not currently online.",
        );
      }

      const rows = await tx.execute<RequestRow>(sql`
        INSERT INTO native_live_external_session_requests (
          user_id,
          expires_at
        ) VALUES (
          ${input.userId}::uuid,
          now() + ${REQUEST_TTL_MS} * interval '1 millisecond'
        )
        RETURNING
          id,
          status,
          failure_code,
          result,
          created_at::text,
          completed_at::text
      `);
      return readRequest(rows[0]!);
    });

    await this.wake?.notify({
      userId: input.userId,
      kind: "foreground",
    });
    return request;
  }

  async readListRequest(input: {
    userId: string;
    requestId: string;
  }): Promise<NativeLiveExternalSessionRequest | null> {
    await this.db.execute(sql`
      UPDATE native_live_external_session_requests
      SET status = 'expired',
          failure_code = 'REQUEST_EXPIRED',
          completed_at = now(),
          updated_at = now()
      WHERE id = ${input.requestId}::uuid
        AND user_id = ${input.userId}::uuid
        AND status = 'pending'
        AND expires_at <= now()
    `);

    const rows = await this.db.execute<RequestRow>(sql`
      SELECT
        id,
        status,
        failure_code,
        result,
        created_at::text,
        completed_at::text
      FROM native_live_external_session_requests
      WHERE id = ${input.requestId}::uuid
        AND user_id = ${input.userId}::uuid
      LIMIT 1
    `);
    return rows[0] ? readRequest(rows[0]) : null;
  }

  async reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveExternalSessionReservation | null> {
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
        throw new NativeLiveExternalSessionBridgeError(
          "LISTENER_NOT_ACTIVE",
          "Native live listener lease is not active.",
        );
      }

      await tx.execute(sql`
        UPDATE native_live_external_session_requests
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
        UPDATE native_live_external_session_requests
        SET status = 'expired',
            failure_code = 'REQUEST_EXPIRED',
            completed_at = now(),
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'pending'
          AND expires_at <= now()
      `);

      const rows = await tx.execute<{ id: string }>(sql`
        WITH candidate AS (
          SELECT id
          FROM native_live_external_session_requests
          WHERE user_id = ${input.userId}::uuid
            AND status = 'pending'
            AND expires_at > now()
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE native_live_external_session_requests AS request
        SET status = 'reserved',
            reserved_by = ${input.listenerInstanceId}::uuid,
            reserved_at = now(),
            reservation_expires_at =
              now() + ${RESERVATION_TTL_MS}
                * interval '1 millisecond',
            updated_at = now()
        FROM candidate
        WHERE request.id = candidate.id
        RETURNING request.id
      `);
      return rows[0]
        ? { reservationId: rows[0].id }
        : null;
    });
  }

  async complete(input: {
    userId: string;
    listenerInstanceId: string;
    reservationId: string;
    outcome:
      | {
          status: "success";
          sessions: NativeLiveExternalSession[];
        }
      | {
          status: "failure";
          failureCode: string;
        };
  }): Promise<"completed" | "failed"> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{
        status: NativeLiveExternalSessionRequestStatus;
        reserved_by: string | null;
        result: unknown;
        failure_code: string | null;
      }>(sql`
        SELECT status, reserved_by, result, failure_code
        FROM native_live_external_session_requests
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
        if (
          current?.status === "completed"
          && input.outcome.status === "success"
          && JSON.stringify(current.result)
            === JSON.stringify(input.outcome.sessions)
        ) {
          return "completed";
        }
        if (
          current?.status === "failed"
          && input.outcome.status === "failure"
          && current.failure_code
            === normalizeFailureCode(input.outcome.failureCode)
        ) {
          return "failed";
        }
        throw new NativeLiveExternalSessionBridgeError(
          "RESERVATION_CONFLICT",
          "External session reservation is no longer valid.",
        );
      }

      if (input.outcome.status === "failure") {
        await tx.execute(sql`
          UPDATE native_live_external_session_requests
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
        return "failed";
      }

      const normalizedSessions =
        normalizeSessions(input.outcome.sessions);
      const ownedRows = await tx.execute<{
        provider_session_id: string;
      }>(sql`
        SELECT DISTINCT provider_session_id
        FROM conversation_provider_session_checkpoints
        WHERE user_id = ${input.userId}::uuid
          AND provider = 'claude_code'
      `);
      const ownedSessionIds = new Set(
        ownedRows.map((row) => row.provider_session_id),
      );
      const sessions = normalizedSessions.filter(
        (session) => !ownedSessionIds.has(session.sessionId),
      );
      await tx.execute(sql`
        UPDATE native_live_external_session_requests
        SET status = 'completed',
            result = ${JSON.stringify(sessions)}::jsonb,
            failure_code = NULL,
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            completed_at = now(),
            updated_at = now()
        WHERE id = ${input.reservationId}::uuid
          AND user_id = ${input.userId}::uuid
      `);
      return "completed";
    });
  }

  async createConversationFromSession(input: {
    userId: string;
    requestId: string;
    sourceSessionId: string;
    title?: string | null;
  }): Promise<NativeLiveExternalSessionConversation> {
    return this.db.transaction(async (tx) => {
      const requestRows = await tx.execute<{
        status: NativeLiveExternalSessionRequestStatus;
        result: unknown;
      }>(sql`
        SELECT status, result
        FROM native_live_external_session_requests
        WHERE id = ${input.requestId}::uuid
          AND user_id = ${input.userId}::uuid
        FOR SHARE
        LIMIT 1
      `);
      const request = requestRows[0];
      if (!request) {
        throw new NativeLiveExternalSessionBridgeError(
          "REQUEST_NOT_FOUND",
          "External session request was not found.",
        );
      }
      if (request.status !== "completed") {
        throw new NativeLiveExternalSessionBridgeError(
          "REQUEST_NOT_READY",
          "External session request has not completed.",
        );
      }
      const sessions = normalizeSessions(request.result);
      const source = sessions.find(
        (session) => session.sessionId === input.sourceSessionId,
      );
      if (!source) {
        throw new NativeLiveExternalSessionBridgeError(
          "SESSION_NOT_FOUND",
          "Claude session was not found in the completed session listing.",
        );
      }

      const requestedTitle = normalizeTitle(input.title);
      const sourceTitle = normalizeTitle(
        source.customTitle ?? source.summary ?? source.firstPrompt,
      );
      const title = requestedTitle ?? sourceTitle;

      const rows = await tx.execute<{
        id: string;
        title: string | null;
        created_at: string;
        updated_at: string;
      }>(sql`
        INSERT INTO conversations (
          user_id,
          origin,
          lifecycle_status,
          title,
          provider,
          source_conversation_id,
          source_fingerprint,
          first_seen_import_id,
          last_seen_import_id
        ) VALUES (
          ${input.userId}::uuid,
          'native_live',
          'active',
          ${title},
          NULL,
          NULL,
          NULL,
          NULL,
          NULL
        )
        RETURNING
          id,
          title,
          created_at::text,
          updated_at::text
      `);
      const conversation = rows[0]!;

      await tx.execute(sql`
        INSERT INTO native_live_conversation_provider_bootstraps (
          conversation_id,
          user_id,
          provider,
          source_provider_session_id,
          workspace_id,
          effective_workspace_root,
          source_request_id
        ) VALUES (
          ${conversation.id}::uuid,
          ${input.userId}::uuid,
          'claude_code',
          ${source.sessionId},
          ${source.workspaceId}::uuid,
          ${source.workspaceRoot},
          ${input.requestId}::uuid
        )
      `);

      if (source.workspaceId) {
        await tx.execute(sql`
          INSERT INTO workspace_conversations (
            user_id,
            workspace_id,
            conversation_id
          ) VALUES (
            ${input.userId}::uuid,
            ${source.workspaceId}::uuid,
            ${conversation.id}::uuid
          )
          ON CONFLICT DO NOTHING
        `);
      }

      return {
        id: conversation.id,
        title: conversation.title,
        currentHeadMessageId: null,
        lastMessageAt: null,
        createdAt: new Date(conversation.created_at).toISOString(),
        updatedAt: new Date(conversation.updated_at).toISOString(),
      };
    });
  }
}

type RequestRow = {
  id: string;
  status: NativeLiveExternalSessionRequestStatus;
  failure_code: string | null;
  result: unknown;
  created_at: string;
  completed_at: string | null;
};

function readRequest(row: RequestRow): NativeLiveExternalSessionRequest {
  return {
    id: row.id,
    status: row.status,
    failureCode: row.failure_code,
    sessions:
      row.status === "completed"
        ? normalizeSessions(row.result)
        : [],
    createdAt: new Date(row.created_at).toISOString(),
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
  };
}

function normalizeSessions(value: unknown): NativeLiveExternalSession[] {
  if (!Array.isArray(value)) return [];
  const sessions: NativeLiveExternalSession[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const sessionId = normalizeString(row.sessionId);
    const workspaceRoot = normalizeString(row.workspaceRoot);
    if (!sessionId || !workspaceRoot || seen.has(sessionId)) continue;
    seen.add(sessionId);
    sessions.push({
      sessionId,
      summary: normalizeString(row.summary),
      customTitle: normalizeString(row.customTitle),
      firstPrompt: normalizeString(row.firstPrompt),
      gitBranch: normalizeString(row.gitBranch),
      lastModified: finiteNumber(row.lastModified),
      createdAt: finiteNumber(row.createdAt),
      workspaceId: normalizeString(row.workspaceId),
      workspaceRoot,
    });
  }
  return sessions
    .sort((left, right) =>
      (right.lastModified ?? 0) - (left.lastModified ?? 0)
    )
    .slice(0, 200);
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : null;
}

function normalizeTitle(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return [...normalized].slice(0, 200).join("");
}

function normalizeFailureCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized ? normalized.slice(0, 64) : "SESSION_LIST_FAILED";
}
