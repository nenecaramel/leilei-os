import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  nativeLiveRuntimeListenerLeases,
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
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const SEMANTIC_RESERVATION_LEASE_MS = 300_000;
const SEMANTIC_COMPLETION_INTERVAL_MS = 2_000;

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
      || existing.query !== input.plan.query
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
          WHERE semantic.user_id = ${input.userId}::uuid
            AND semantic.status = 'pending'
            AND preparation.status = 'prepared'
            AND preparation.mind_prepared = false
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

      if (request.status === "completed" || request.status === "fallback") {
        return request;
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

      validateScores(request.candidates, input.scores);
      const completedAt = new Date();
      await transaction
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
        );

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

      if (request.status === "completed" || request.status === "fallback") {
        return request;
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
      await transaction
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
        );

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

  async findCompletionPending(): Promise<SemanticRequest | null> {
    const rows = await this.db.execute<{ prepare_id: string; user_id: string }>(
      sql`
        SELECT semantic.prepare_id, semantic.user_id
        FROM native_live_semantic_scoring_requests AS semantic
        INNER JOIN native_live_turn_preparations AS preparation
          ON preparation.id = semantic.prepare_id
         AND preparation.user_id = semantic.user_id
        WHERE semantic.status IN ('completed', 'fallback')
          AND preparation.status = 'prepared'
          AND preparation.mind_prepared = false
        ORDER BY semantic.completed_at ASC, semantic.prepare_id ASC
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
  ) {}

  stage(input: {
    userId: string;
    preparation: NativeLivePreparedTurn;
    plan: NativeLiveMindSemanticPlan;
  }): Promise<void> {
    return this.repository.stage(input);
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
    await this.resume(request);
  }

  async submitFallback(input: {
    userId: string;
    listenerInstanceId: string;
    prepareId: string;
    code: NativeLiveSemanticFallbackCode;
  }): Promise<void> {
    const request = await this.repository.acceptFallback(input);
    await this.resume(request);
  }

  async processNextCompletion(): Promise<"processed" | "idle"> {
    const request = await this.repository.findCompletionPending();
    if (!request) return "idle";
    await this.resume(request);
    return "processed";
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
        prompt = await this.mind.preparePrompt({
          userId: request.userId,
          preparation,
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

export type NativeLiveSemanticCompletionScheduler = {
  start(): void;
  stopScheduling(): void;
  runNow(): Promise<number>;
  drain(): Promise<void>;
};

export function createNativeLiveSemanticCompletionScheduler(input: {
  service: Pick<
    NativeLiveSemanticHandshakeService,
    "processNextCompletion"
  >;
  intervalMs?: number;
  batchLimit?: number;
}): NativeLiveSemanticCompletionScheduler {
  const intervalMs = input.intervalMs ?? SEMANTIC_COMPLETION_INTERVAL_MS;
  const batchLimit = input.batchLimit ?? 25;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<number> | null = null;
  let stopping = false;

  const runNow = (): Promise<number> => {
    if (stopping) return Promise.resolve(0);
    if (inFlight) return inFlight;

    const run = (async () => {
      let attempts = 0;
      let processed = 0;
      while (attempts < batchLimit) {
        attempts += 1;
        try {
          const outcome = await input.service.processNextCompletion();
          if (outcome === "idle") break;
          processed += 1;
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
    start() {
      if (stopping || timer) return;
      timer = setInterval(() => void runNow(), intervalMs);
      timer.unref?.();
      void runNow();
    },
    stopScheduling() {
      if (stopping) return;
      stopping = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    runNow,
    async drain() {
      if (inFlight) await inFlight.catch(() => undefined);
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
