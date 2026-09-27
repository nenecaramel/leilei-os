import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  nativeLiveRuntimeListenerLeases,
  runtimeMindSemanticGroupingRequests,
} from "../../database/schema.js";
import type {
  BreathSemanticCandidate,
} from "./breath-semantic-recall.js";
import type {
  MindSemanticGroupingFallbackCode,
  MindSemanticGroupingKind,
  MindSemanticGroupingMatch,
  MindSemanticGroupingPort,
  MindSemanticGroupingReservation,
} from "./mind-semantic-grouping.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

const RESERVATION_LEASE_MS = 300_000;

type GroupingRequest = {
  id: string;
  userId: string;
  subjectId: string;
  kind: MindSemanticGroupingKind;
  queryStateId: string;
  query: string;
  candidates: BreathSemanticCandidate[];
  status: "pending" | "reserved" | "completed" | "fallback";
  reservedBy: string | null;
  scores: Record<string, number> | null;
  fallbackCode: string | null;
};

export class MindSemanticGroupingRepositoryError extends Error {
  constructor(
    readonly code:
      | "LISTENER_NOT_ACTIVE"
      | "RESERVATION_CONFLICT"
      | "SCORE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "MindSemanticGroupingRepositoryError";
  }
}

export class DrizzleMindSemanticGroupingRepository
implements MindSemanticGroupingPort {
  constructor(
    private readonly db: Database,
    private readonly workWake?: {
      notify(input: { userId: string; kind: "semantic" }): Promise<void>;
    },
  ) {}

  async stage(input: {
    userId: string;
    subjectId: string;
    kind: MindSemanticGroupingKind;
    queryStateId: string;
    query: string;
    candidates: readonly BreathSemanticCandidate[];
  }): Promise<boolean> {
    const query = input.query.trim();
    if (!query) {
      throw new Error("Mind semantic grouping query must not be blank.");
    }
    if (
      input.candidates.length < 1
      || input.candidates.length > 64
    ) {
      throw new Error(
        "Mind semantic grouping requires 1 to 64 candidates.",
      );
    }

    const inserted = await this.db
      .insert(runtimeMindSemanticGroupingRequests)
      .values({
        id: randomUUID(),
        userId: input.userId,
        subjectId: input.subjectId,
        kind: input.kind,
        queryStateId: input.queryStateId,
        query,
        candidates: input.candidates.map(candidateRecord),
        status: "pending",
      })
      .onConflictDoNothing({
        target: [
          runtimeMindSemanticGroupingRequests.userId,
          runtimeMindSemanticGroupingRequests.subjectId,
          runtimeMindSemanticGroupingRequests.kind,
          runtimeMindSemanticGroupingRequests.queryStateId,
        ],
      })
      .returning({ id: runtimeMindSemanticGroupingRequests.id });

    if (inserted.length === 0) return false;
    try {
      await this.workWake?.notify({
        userId: input.userId,
        kind: "semantic",
      });
    } catch {
      // Durable queue state is authoritative.
    }
    return true;
  }

  async listCompletedMatches(input: {
    userId: string;
    subjectId: string;
    kind: MindSemanticGroupingKind;
    stateIds: readonly string[];
  }): Promise<readonly MindSemanticGroupingMatch[]> {
    const stateIds = [...new Set(input.stateIds)];
    if (stateIds.length === 0) return [];

    const rows = await this.db
      .select({
        queryStateId: runtimeMindSemanticGroupingRequests.queryStateId,
        candidates: runtimeMindSemanticGroupingRequests.candidates,
        scores: runtimeMindSemanticGroupingRequests.scores,
      })
      .from(runtimeMindSemanticGroupingRequests)
      .where(
        and(
          eq(runtimeMindSemanticGroupingRequests.userId, input.userId),
          eq(runtimeMindSemanticGroupingRequests.subjectId, input.subjectId),
          eq(runtimeMindSemanticGroupingRequests.kind, input.kind),
          eq(runtimeMindSemanticGroupingRequests.status, "completed"),
          inArray(
            runtimeMindSemanticGroupingRequests.queryStateId,
            stateIds,
          ),
        ),
      );

    const allowed = new Set(stateIds);
    const matches: MindSemanticGroupingMatch[] = [];
    for (const row of rows) {
      if (!row.scores) continue;
      for (const candidate of parseCandidates(row.candidates, input.kind)) {
        if (!allowed.has(candidate.stateId)) continue;
        const score = row.scores[candidate.stateId];
        if (
          typeof score !== "number"
          || !Number.isFinite(score)
          || score < 0
          || score > 1
        ) {
          continue;
        }
        matches.push({
          queryStateId: row.queryStateId,
          candidateStateId: candidate.stateId,
          score,
        });
      }
    }
    return matches;
  }

  async reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<MindSemanticGroupingReservation | null> {
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
        throw new MindSemanticGroupingRepositoryError(
          "LISTENER_NOT_ACTIVE",
          "Mind semantic grouping listener lease is not active.",
        );
      }

      await transaction.execute(sql`
        UPDATE runtime_mind_semantic_grouping_requests
        SET status = 'pending',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'reserved'
          AND reservation_expires_at <= now()
      `);

      const reserved = await transaction.execute<{ id: string }>(sql`
        WITH candidate AS (
          SELECT id
          FROM runtime_mind_semantic_grouping_requests
          WHERE user_id = ${input.userId}::uuid
            AND status = 'pending'
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE runtime_mind_semantic_grouping_requests AS grouping
        SET status = 'reserved',
            reserved_by = ${input.listenerInstanceId}::uuid,
            reserved_at = now(),
            reservation_expires_at =
              now() + ${RESERVATION_LEASE_MS} * interval '1 millisecond',
            updated_at = now()
        FROM candidate
        WHERE grouping.id = candidate.id
          AND grouping.status = 'pending'
        RETURNING grouping.id
      `);

      if (!reserved[0]) return null;
      const request = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        reserved[0].id,
        false,
      );
      if (!request) {
        throw new Error("Reserved Mind semantic grouping request disappeared.");
      }
      return {
        reservationId: request.id,
        query: request.query,
        candidates: request.candidates,
      };
    });
  }

  async acceptScores(input: {
    userId: string;
    listenerInstanceId: string;
    requestId: string;
    scores: Record<string, number>;
  }): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const request = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        input.requestId,
        true,
      );
      if (!request) {
        throw new MindSemanticGroupingRepositoryError(
          "RESERVATION_CONFLICT",
          "Mind semantic grouping reservation was not found.",
        );
      }
      validateScores(request.candidates, input.scores);
      if (request.status === "completed") {
        if (!isDeepStrictEqual(request.scores, input.scores)) {
          throw new MindSemanticGroupingRepositoryError(
            "RESERVATION_CONFLICT",
            "Mind semantic grouping scores conflict with the completed reservation.",
          );
        }
        return;
      }
      if (
        request.status !== "reserved"
        || request.reservedBy !== input.listenerInstanceId
      ) {
        throw new MindSemanticGroupingRepositoryError(
          "RESERVATION_CONFLICT",
          "Mind semantic grouping reservation is not owned by this listener.",
        );
      }

      const completedAt = new Date();
      const updated = await transaction
        .update(runtimeMindSemanticGroupingRequests)
        .set({
          status: "completed",
          reservedBy: null,
          reservedAt: null,
          reservationExpiresAt: null,
          scores: input.scores,
          fallbackCode: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(runtimeMindSemanticGroupingRequests.id, input.requestId),
            eq(runtimeMindSemanticGroupingRequests.userId, input.userId),
            eq(runtimeMindSemanticGroupingRequests.status, "reserved"),
            eq(
              runtimeMindSemanticGroupingRequests.reservedBy,
              input.listenerInstanceId,
            ),
          ),
        )
        .returning({ id: runtimeMindSemanticGroupingRequests.id });
      if (updated.length !== 1) {
        throw new MindSemanticGroupingRepositoryError(
          "RESERVATION_CONFLICT",
          "Mind semantic grouping reservation changed before score commit.",
        );
      }
    });
  }

  async acceptFallback(input: {
    userId: string;
    listenerInstanceId: string;
    requestId: string;
    code: MindSemanticGroupingFallbackCode;
  }): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const request = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        input.requestId,
        true,
      );
      if (!request) {
        throw new MindSemanticGroupingRepositoryError(
          "RESERVATION_CONFLICT",
          "Mind semantic grouping reservation was not found.",
        );
      }
      if (request.status === "fallback") {
        if (request.fallbackCode !== input.code) {
          throw new MindSemanticGroupingRepositoryError(
            "RESERVATION_CONFLICT",
            "Mind semantic grouping fallback conflicts with the completed reservation.",
          );
        }
        return;
      }
      if (
        request.status !== "reserved"
        || request.reservedBy !== input.listenerInstanceId
      ) {
        throw new MindSemanticGroupingRepositoryError(
          "RESERVATION_CONFLICT",
          "Mind semantic grouping reservation is not owned by this listener.",
        );
      }

      const completedAt = new Date();
      const updated = await transaction
        .update(runtimeMindSemanticGroupingRequests)
        .set({
          status: "fallback",
          reservedBy: null,
          reservedAt: null,
          reservationExpiresAt: null,
          scores: null,
          fallbackCode: input.code,
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(runtimeMindSemanticGroupingRequests.id, input.requestId),
            eq(runtimeMindSemanticGroupingRequests.userId, input.userId),
            eq(runtimeMindSemanticGroupingRequests.status, "reserved"),
            eq(
              runtimeMindSemanticGroupingRequests.reservedBy,
              input.listenerInstanceId,
            ),
          ),
        )
        .returning({ id: runtimeMindSemanticGroupingRequests.id });
      if (updated.length !== 1) {
        throw new MindSemanticGroupingRepositoryError(
          "RESERVATION_CONFLICT",
          "Mind semantic grouping reservation changed before fallback commit.",
        );
      }
    });
  }

  private async getWithExecutor(
    executor: Database | Transaction,
    userId: string,
    requestId: string,
    lock: boolean,
  ): Promise<GroupingRequest | null> {
    const query = executor
      .select({
        id: runtimeMindSemanticGroupingRequests.id,
        userId: runtimeMindSemanticGroupingRequests.userId,
        subjectId: runtimeMindSemanticGroupingRequests.subjectId,
        kind: runtimeMindSemanticGroupingRequests.kind,
        queryStateId: runtimeMindSemanticGroupingRequests.queryStateId,
        query: runtimeMindSemanticGroupingRequests.query,
        candidates: runtimeMindSemanticGroupingRequests.candidates,
        status: runtimeMindSemanticGroupingRequests.status,
        reservedBy: runtimeMindSemanticGroupingRequests.reservedBy,
        scores: runtimeMindSemanticGroupingRequests.scores,
        fallbackCode: runtimeMindSemanticGroupingRequests.fallbackCode,
      })
      .from(runtimeMindSemanticGroupingRequests)
      .where(
        and(
          eq(runtimeMindSemanticGroupingRequests.userId, userId),
          eq(runtimeMindSemanticGroupingRequests.id, requestId),
        ),
      );
    const rows = lock
      ? await query.for("update").limit(1)
      : await query.limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      subjectId: row.subjectId,
      kind: requireGroupingKind(row.kind),
      queryStateId: row.queryStateId,
      query: row.query,
      candidates: parseCandidates(row.candidates, requireGroupingKind(row.kind)),
      status: requireStatus(row.status),
      reservedBy: row.reservedBy,
      scores: row.scores,
      fallbackCode: row.fallbackCode,
    };
  }
}

function candidateRecord(
  candidate: BreathSemanticCandidate,
): Record<string, unknown> {
  return {
    stateId: candidate.stateId,
    kind: candidate.kind,
    text: candidate.text,
  };
}

function parseCandidates(
  value: unknown,
  kind: MindSemanticGroupingKind,
): BreathSemanticCandidate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) {
    throw new Error("Mind semantic grouping candidate snapshot is invalid.");
  }
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Mind semantic grouping candidate snapshot is invalid.");
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.stateId !== "string"
      || !record.stateId.trim()
      || record.kind !== kind
      || typeof record.text !== "string"
      || !record.text.trim()
    ) {
      throw new Error("Mind semantic grouping candidate snapshot is invalid.");
    }
    return {
      stateId: record.stateId,
      kind,
      text: record.text.trim(),
    };
  });
}

function validateScores(
  candidates: readonly BreathSemanticCandidate[],
  scores: Record<string, number>,
): void {
  const expected = candidates.map((candidate) => candidate.stateId).sort();
  const actual = Object.keys(scores).sort();
  if (!isDeepStrictEqual(expected, actual)) {
    throw new MindSemanticGroupingRepositoryError(
      "SCORE_INVALID",
      "Mind semantic grouping scores must cover the exact candidate snapshot.",
    );
  }
  for (const score of Object.values(scores)) {
    if (
      typeof score !== "number"
      || !Number.isFinite(score)
      || score < 0
      || score > 1
    ) {
      throw new MindSemanticGroupingRepositoryError(
        "SCORE_INVALID",
        "Mind semantic grouping score must be between 0 and 1.",
      );
    }
  }
}

function requireGroupingKind(value: unknown): MindSemanticGroupingKind {
  if (
    value !== "drive"
    && value !== "thought"
    && value !== "curiosity"
    && value !== "topic"
  ) {
    throw new Error("Mind semantic grouping kind is invalid.");
  }
  return value;
}

function requireStatus(
  value: unknown,
): GroupingRequest["status"] {
  if (
    value !== "pending"
    && value !== "reserved"
    && value !== "completed"
    && value !== "fallback"
  ) {
    throw new Error("Mind semantic grouping status is invalid.");
  }
  return value;
}
