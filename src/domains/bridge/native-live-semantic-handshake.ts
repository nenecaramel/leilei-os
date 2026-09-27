import { isDeepStrictEqual } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  nativeLiveSemanticScoringRequests,
  nativeLiveTurnPreparations,
} from "../../database/schema.js";
import type {
  BreathSemanticCandidate,
} from "../runtime/breath-semantic-recall.js";
import type {
  NativeLiveMindSemanticPlan,
} from "../runtime/native-live-mind-runtime.js";
import type {
  NativeLiveBackendMindRuntime,
} from "./native-live-backend-mind-runtime.js";
import type {
  NativeLiveBackendTurnPort,
  NativeLivePreparedTurn,
} from "./native-live-backend-turn-coordinator.js";
import type {
  NativeLiveBackendRelayService,
} from "./native-live-backend-relay.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

const SEMANTIC_RESERVATION_LEASE_MS = 300_000;
export const SEMANTIC_COMPLETION_RETRY_MS = 5_000;

export type NativeLiveSemanticScoringReservation = {
  reservationId: string;
  query: string;
  candidates: BreathSemanticCandidate[];
};

export type NativeLiveSemanticFallbackCode =
  | "E5_PROVIDER_UNAVAILABLE"
  | "E5_SCORING_FAILED";

export class NativeLiveSemanticHandshakeError extends Error {
  constructor(
    readonly code:
      | "LISTENER_NOT_ACTIVE"
      | "SEMANTIC_RESERVATION_CONFLICT"
      | "SEMANTIC_SCORE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "NativeLiveSemanticHandshakeError";
  }
}

export interface NativeLiveSemanticPreparationStager {
  stage(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    plan: NativeLiveMindSemanticPlan;
  }): Promise<void>;

  readPlan?(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLiveMindSemanticPlan | null>;
}

type SemanticRequest = {
  prepareId: string;
  userId: string;
  conversationId: string;
  manifestId: string;
  assembledAt: string;
  snapshotSequence: number;
  query: string;
  candidates: BreathSemanticCandidate[];
  status: "pending" | "reserved" | "completed" | "fallback";
  reservedBy: string | null;
  scores: Record<string, number> | null;
  fallbackCode: string | null;
};

export class DrizzleNativeLiveSemanticScoringRepository
implements NativeLiveSemanticPreparationStager {
  constructor(private readonly db: Database) {}

  async stage(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    plan: NativeLiveMindSemanticPlan;
  }): Promise<void> {
    await this.db
      .insert(nativeLiveSemanticScoringRequests)
      .values({
        prepareId: input.preparation.prepareId,
        userId: input.userId,
        conversationId: input.preparation.conversationId,
        manifestId: input.plan.manifestId,
        assembledAt: new Date(input.plan.assembledAt),
        snapshotSequence: input.plan.snapshotSequence,
        query: input.plan.query,
        candidates: input.plan.candidates.map(candidateRecord),
        status: "pending",
      })
      .onConflictDoNothing();

    const existing = await this.get({
      userId: input.userId,
      prepareId: input.preparation.prepareId,
    });
    if (!existing) {
      throw new Error("Semantic scoring request could not be persisted.");
    }
    if (
      existing.conversationId !== input.preparation.conversationId
      || existing.manifestId !== input.plan.manifestId
      || existing.assembledAt !== input.plan.assembledAt
      || existing.snapshotSequence !== input.plan.snapshotSequence
      || existing.query !== input.plan.query
      || !isDeepStrictEqual(existing.candidates, input.plan.candidates)
    ) {
      throw new Error(
        "Semantic scoring request conflicts with an existing preparation.",
      );
    }
  }

  async reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveSemanticScoringReservation | null> {
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
        throw new NativeLiveSemanticHandshakeError(
          "LISTENER_NOT_ACTIVE",
          "Native live semantic listener lease is not active.",
        );
      }

      await transaction.execute(sql`
        UPDATE native_live_semantic_scoring_requests
        SET status = 'pending',
            reserved_by = NULL,
            reserved_at = NULL,
            reservation_expires_at = NULL,
            updated_at = now()
        WHERE user_id = ${input.userId}::uuid
          AND status = 'reserved'
          AND reservation_expires_at <= now()
      `);

      const reserved = await transaction.execute<{ prepare_id: string }>(sql`
        WITH candidate AS (
          SELECT semantic.prepare_id
          FROM native_live_semantic_scoring_requests AS semantic
          INNER JOIN native_live_turn_preparations AS preparation
            ON preparation.id = semantic.prepare_id
           AND preparation.user_id = semantic.user_id
          INNER JOIN conversations AS conversation
            ON conversation.id = semantic.conversation_id
           AND conversation.user_id = semantic.user_id
          WHERE semantic.user_id = ${input.userId}::uuid
            AND semantic.status = 'pending'
            AND preparation.status = 'prepared'
            AND preparation.mind_prepared = false
            AND conversation.origin = 'native_live'
            AND conversation.lifecycle_status = 'active'
          ORDER BY semantic.created_at ASC, semantic.prepare_id ASC
          FOR UPDATE OF semantic SKIP LOCKED
          LIMIT 1
        )
        UPDATE native_live_semantic_scoring_requests AS semantic
        SET status = 'reserved',
            reserved_by = ${input.listenerInstanceId}::uuid,
            reserved_at = now(),
            reservation_expires_at =
              now() + ${SEMANTIC_RESERVATION_LEASE_MS} * interval '1 millisecond',
            updated_at = now()
        FROM candidate
        WHERE semantic.prepare_id = candidate.prepare_id
          AND semantic.status = 'pending'
        RETURNING semantic.prepare_id
      `);

      if (!reserved[0]) return null;
      const request = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        reserved[0].prepare_id,
      );
      if (!request) {
        throw new Error("Reserved semantic scoring request disappeared.");
      }
      return {
        reservationId: request.prepareId,
        query: request.query,
        candidates: request.candidates,
      };
    });
  }

  async acceptScores(input: {
    userId: string;
    listenerInstanceId: string;
    prepareId: string;
    scores: Record<string, number>;
  }): Promise<SemanticRequest> {
    return this.db.transaction(async (transaction) => {
      const request = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        input.prepareId,
        true,
      );
      if (!request) {
        throw new NativeLiveSemanticHandshakeError(
          "SEMANTIC_RESERVATION_CONFLICT",
          "Semantic scoring request was not found.",
        );
      }

      validateScores(request.candidates, input.scores);
      if (request.status === "completed") {
        if (!isDeepStrictEqual(request.scores, input.scores)) {
          throw new NativeLiveSemanticHandshakeError(
            "SEMANTIC_RESERVATION_CONFLICT",
            "Semantic scores conflict with the completed reservation.",
          );
        }
        return request;
      }
      if (request.status === "fallback") {
        throw new NativeLiveSemanticHandshakeError(
          "SEMANTIC_RESERVATION_CONFLICT",
          "Semantic reservation already completed through fallback.",
        );
      }
      if (
        request.status !== "reserved"
        || request.reservedBy !== input.listenerInstanceId
      ) {
        throw new NativeLiveSemanticHandshakeError(
          "SEMANTIC_RESERVATION_CONFLICT",
          "Semantic scoring request is not owned by this listener.",
        );
      }

      const completedAt = new Date();
      const updated = await transaction
        .update(nativeLiveSemanticScoringRequests)
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
            eq(
              nativeLiveSemanticScoringRequests.prepareId,
              input.prepareId,
            ),
            eq(nativeLiveSemanticScoringRequests.userId, input.userId),
            eq(nativeLiveSemanticScoringRequests.status, "reserved"),
            eq(
              nativeLiveSemanticScoringRequests.reservedBy,
              input.listenerInstanceId,
            ),
          ),
        )
        .returning({ prepareId: nativeLiveSemanticScoringRequests.prepareId });

      if (updated.length !== 1) {
        throw new NativeLiveSemanticHandshakeError(
          "SEMANTIC_RESERVATION_CONFLICT",
          "Semantic score reservation changed before commit.",
        );
      }

      return {
        ...request,
        status: "completed",
        reservedBy: null,
        scores: input.scores,
        fallbackCode: null,
      };
    });
  }

  async acceptFallback(input: {
    userId: string;
    listenerInstanceId: string;
    prepareId: string;
    code: NativeLiveSemanticFallbackCode;
  }): Promise<SemanticRequest> {
    return this.db.transaction(async (transaction) => {
      const request = await this.getWithExecutor(
        transaction as Transaction,
        input.userId,
        input.prepareId,
        true,
      );
      if (!request) {
        throw new NativeLiveSemanticHandshakeError(
          "SEMANTIC_RESERVATION_CONFLICT",
          "Semantic scoring request was not found.",
        );
      }

      if (request.status === "fallback") {
        if (request.fallbackCode !== input.code) {
          throw new NativeLiveSemanticHandshakeError(
            "SEMANTIC_RESERVATION_CONFLICT",
            "Semantic fallback conflicts with the completed reservation.",
          );
        }
        return request;
      }
      if (request.status === "completed") {
        throw new NativeLiveSemanticHandshakeError(
          "SEMANTIC_RESERVATION_CONFLICT",
          "Semantic reservation already completed with scores.",
        );
      }
      if (
        request.status !== "reserved"
        || request.reservedBy !== input.listenerInstanceId
      ) {
        throw new NativeLiveSemanticHandshakeError(
          "SEMANTIC_RESERVATION_CONFLICT",
          "Semantic scoring request is not owned by this listener.",
        );
      }

      const completedAt = new Date();
      const updated = await transaction
        .update(nativeLiveSemanticScoringRequests)
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
            eq(
              nativeLiveSemanticScoringRequests.prepareId,
              input.prepareId,
            ),
            eq(nativeLiveSemanticScoringRequests.userId, input.userId),
            eq(nativeLiveSemanticScoringRequests.status, "reserved"),
            eq(
              nativeLiveSemanticScoringRequests.reservedBy,
              input.listenerInstanceId,
            ),
          ),
        )
        .returning({ prepareId: nativeLiveSemanticScoringRequests.prepareId });

      if (updated.length !== 1) {
        throw new NativeLiveSemanticHandshakeError(
          "SEMANTIC_RESERVATION_CONFLICT",
          "Semantic fallback reservation changed before commit.",
        );
      }

      return {
        ...request,
        status: "fallback",
        reservedBy: null,
        scores: null,
        fallbackCode: input.code,
      };
    });
  }

  async get(input: {
    userId: string;
    prepareId: string;
  }): Promise<SemanticRequest | null> {
    return this.getWithExecutor(this.db, input.userId, input.prepareId);
  }

  async deferCompletion(input: {
    userId: string;
    prepareId: string;
    errorName: string;
  }): Promise<boolean> {
    const rows = await this.db
      .update(nativeLiveSemanticScoringRequests)
      .set({
        resumeRetryCount:
          sql`${nativeLiveSemanticScoringRequests.resumeRetryCount} + 1`,
        resumeAvailableAt:
          sql`now() + ${SEMANTIC_COMPLETION_RETRY_MS} * interval '1 millisecond'`,
        resumeLastErrorName: input.errorName.slice(0, 128),
        updatedAt: sql`now()`,
      })
      .where(sql`
        ${nativeLiveSemanticScoringRequests.userId} = ${input.userId}::uuid
        AND ${nativeLiveSemanticScoringRequests.prepareId} = ${input.prepareId}::uuid
        AND ${nativeLiveSemanticScoringRequests.status}
          IN ('completed', 'fallback')
      `)
      .returning({ prepareId: nativeLiveSemanticScoringRequests.prepareId });
    return rows.length === 1;
  }

  async findCompletionPending(): Promise<SemanticRequest | null> {
    const rows = await this.db.execute<{ prepare_id: string; user_id: string }>(
      sql`
        WITH conversation_heads AS (
          SELECT DISTINCT ON (
            semantic.user_id,
            semantic.conversation_id
          )
            semantic.prepare_id,
            semantic.user_id,
            semantic.resume_available_at,
            semantic.completed_at
          FROM native_live_semantic_scoring_requests AS semantic
          INNER JOIN native_live_turn_preparations AS preparation
            ON preparation.id = semantic.prepare_id
           AND preparation.user_id = semantic.user_id
          INNER JOIN conversations AS conversation
            ON conversation.id = semantic.conversation_id
           AND conversation.user_id = semantic.user_id
          WHERE semantic.status IN ('completed', 'fallback')
            AND preparation.status = 'prepared'
            AND preparation.dispatch_status = 'staged'
            AND conversation.origin = 'native_live'
            AND conversation.lifecycle_status = 'active'
          ORDER BY
            semantic.user_id ASC,
            semantic.conversation_id ASC,
            semantic.completed_at ASC,
            semantic.prepare_id ASC
        )
        SELECT prepare_id, user_id
        FROM conversation_heads
        WHERE resume_available_at <= now()
        ORDER BY resume_available_at ASC,
          completed_at ASC,
          prepare_id ASC
        LIMIT 1
      `,
    );
    const row = rows[0];
    if (!row) return null;
    return this.get({
      userId: row.user_id,
      prepareId: row.prepare_id,
    });
  }

  private async getWithExecutor(
    executor: Database | Transaction,
    userId: string,
    prepareId: string,
    lock = false,
  ): Promise<SemanticRequest | null> {
    const query = executor
      .select({
        prepareId: nativeLiveSemanticScoringRequests.prepareId,
        userId: nativeLiveSemanticScoringRequests.userId,
        conversationId: nativeLiveSemanticScoringRequests.conversationId,
        manifestId: nativeLiveSemanticScoringRequests.manifestId,
        assembledAt: nativeLiveSemanticScoringRequests.assembledAt,
        snapshotSequence:
          nativeLiveSemanticScoringRequests.snapshotSequence,
        query: nativeLiveSemanticScoringRequests.query,
        candidates: nativeLiveSemanticScoringRequests.candidates,
        status: nativeLiveSemanticScoringRequests.status,
        reservedBy: nativeLiveSemanticScoringRequests.reservedBy,
        scores: nativeLiveSemanticScoringRequests.scores,
        fallbackCode: nativeLiveSemanticScoringRequests.fallbackCode,
      })
      .from(nativeLiveSemanticScoringRequests)
      .where(
        and(
          eq(nativeLiveSemanticScoringRequests.userId, userId),
          eq(nativeLiveSemanticScoringRequests.prepareId, prepareId),
        ),
      );

    const rows = lock
      ? await query.for("update").limit(1)
      : await query.limit(1);
    const row = rows[0];
    if (!row) return null;

    return {
      prepareId: row.prepareId,
      userId: row.userId,
      conversationId: row.conversationId,
      manifestId: row.manifestId,
      assembledAt: row.assembledAt.toISOString(),
      snapshotSequence: row.snapshotSequence,
      query: row.query,
      candidates: parseCandidates(row.candidates),
      status: row.status,
      reservedBy: row.reservedBy,
      scores: row.scores,
      fallbackCode: row.fallbackCode,
    };
  }
}

export class NativeLiveSemanticHandshakeService
implements NativeLiveSemanticPreparationStager {
  constructor(
    private readonly repository: DrizzleNativeLiveSemanticScoringRepository,
    private readonly turns: Pick<
      NativeLiveBackendTurnPort,
      "getPreparation" | "persistMindPreparedPrompt"
    >,
    private readonly mind: NativeLiveBackendMindRuntime,
    private readonly relay: Pick<
      NativeLiveBackendRelayService,
      "enqueuePreparation"
    >,
    private readonly workWake?: {
      notify(input: {
        userId: string;
        kind: "semantic";
      }): Promise<void>;
    },
  ) {}

  async stage(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    plan: NativeLiveMindSemanticPlan;
  }): Promise<void> {
    await this.repository.stage(input);
    try {
      await this.workWake?.notify({
        userId: input.userId,
        kind: "semantic",
      });
    } catch {
      // Durable semantic queue state is authoritative.
    }
  }

  async readPlan(input: {
    userId: string;
    prepareId: string;
  }): Promise<NativeLiveMindSemanticPlan | null> {
    const request = await this.repository.get(input);
    return request ? toMindPlan(request) : null;
  }

  reserveNext(input: {
    userId: string;
    listenerInstanceId: string;
  }): Promise<NativeLiveSemanticScoringReservation | null> {
    return this.repository.reserveNext(input);
  }

  async submitScores(input: {
    userId: string;
    listenerInstanceId: string;
    prepareId: string;
    scores: Record<string, number>;
  }): Promise<void> {
    const request = await this.repository.acceptScores(input);
    await this.resumeWithRecovery(request);
  }

  async submitFallback(input: {
    userId: string;
    listenerInstanceId: string;
    prepareId: string;
    code: NativeLiveSemanticFallbackCode;
  }): Promise<void> {
    const request = await this.repository.acceptFallback(input);
    await this.resumeWithRecovery(request);
  }

  async processNextCompletion(): Promise<
    "processed" | "deferred" | "idle"
  > {
    const request = await this.repository.findCompletionPending();
    if (!request) return "idle";
    try {
      await this.resume(request);
      return "processed";
    } catch (error) {
      const deferred = await this.repository.deferCompletion({
        userId: request.userId,
        prepareId: request.prepareId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }).catch(() => false);
      if (!deferred) throw error;
      return "deferred";
    }
  }

  private async resumeWithRecovery(request: SemanticRequest): Promise<void> {
    try {
      await this.resume(request);
    } catch (error) {
      await this.repository.deferCompletion({
        userId: request.userId,
        prepareId: request.prepareId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }).catch(() => false);
      throw error;
    }
  }

  private async resume(request: SemanticRequest): Promise<void> {
    const preparation = await this.turns.getPreparation({
      userId: request.userId,
      prepareId: request.prepareId,
    });
    if (!preparation) {
      throw new Error("Semantic preparation was not found.");
    }

    if (!preparation.mindPrepared) {
      let prompt: string;
      if (request.status === "completed") {
        if (!this.mind.completeSemanticPrompt || !request.scores) {
          throw new Error("Semantic prompt completion is unavailable.");
        }
        prompt = await this.mind.completeSemanticPrompt({
          userId: request.userId,
          preparation,
          plan: toMindPlan(request),
          scores: new Map(Object.entries(request.scores)),
        });
      } else if (request.status === "fallback") {
        if (!this.mind.completeSemanticPrompt) {
          throw new Error("Semantic fallback completion is unavailable.");
        }
        prompt = await this.mind.completeSemanticPrompt({
          userId: request.userId,
          preparation,
          plan: toMindPlan(request),
          scores: null,
        });
      } else {
        throw new Error("Semantic request is not ready for prompt assembly.");
      }

      await this.turns.persistMindPreparedPrompt({
        userId: request.userId,
        prepareId: request.prepareId,
        prompt,
      });
    }

    await this.relay.enqueuePreparation({
      userId: request.userId,
      prepareId: request.prepareId,
    });
  }
}

export type NativeLiveSemanticRecoveryRunner = {
  stop(): void;
  runNow(): Promise<number>;
  drain(): Promise<void>;
};

export function createNativeLiveSemanticRecoveryRunner(input: {
  service: Pick<
    NativeLiveSemanticHandshakeService,
    "processNextCompletion"
  >;
  batchLimit?: number;
}): NativeLiveSemanticRecoveryRunner {
  const batchLimit = input.batchLimit ?? 25;
  let inFlight: Promise<number> | null = null;
  let stopped = false;

  const runNow = (): Promise<number> => {
    if (stopped) return Promise.resolve(0);
    if (inFlight) return inFlight;

    const run = (async () => {
      let attempts = 0;
      let processed = 0;
      while (attempts < batchLimit) {
        attempts += 1;
        try {
          const outcome = await input.service.processNextCompletion();
          if (outcome === "idle") break;
          if (outcome === "processed") processed += 1;
        } catch {
          break;
        }
      }
      return processed;
    })();

    const tracked = run.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };

  return {
    stop(): void {
      stopped = true;
    },
    runNow,
    async drain(): Promise<void> {
      const current = inFlight;
      if (current) await current.catch(() => undefined);
    },
  };
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

function parseCandidates(value: unknown): BreathSemanticCandidate[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new Error("Semantic candidate snapshot is invalid.");
  }

  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Semantic candidate snapshot is invalid.");
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.stateId !== "string"
      || !record.stateId
      || (record.kind !== "memory" && record.kind !== "feel")
      || typeof record.text !== "string"
      || !record.text.trim()
    ) {
      throw new Error("Semantic candidate snapshot is invalid.");
    }
    return {
      stateId: record.stateId,
      kind: record.kind,
      text: record.text,
    };
  });
}

function validateScores(
  candidates: readonly BreathSemanticCandidate[],
  scores: Record<string, number>,
): void {
  const expected = [...candidates]
    .map((candidate) => candidate.stateId)
    .sort();
  const actual = Object.keys(scores).sort();
  if (
    expected.length !== actual.length
    || expected.some((id, index) => id !== actual[index])
  ) {
    throw new NativeLiveSemanticHandshakeError(
      "SEMANTIC_SCORE_INVALID",
      "Semantic score ids do not match the reserved candidate snapshot.",
    );
  }

  for (const score of Object.values(scores)) {
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new NativeLiveSemanticHandshakeError(
        "SEMANTIC_SCORE_INVALID",
        "Semantic scores must be finite numbers between zero and one.",
      );
    }
  }
}

function toMindPlan(
  request: SemanticRequest,
): NativeLiveMindSemanticPlan {
  return {
    manifestId: request.manifestId,
    assembledAt: request.assembledAt,
    snapshotSequence: request.snapshotSequence,
    query: request.query,
    candidates: request.candidates,
  };
}
