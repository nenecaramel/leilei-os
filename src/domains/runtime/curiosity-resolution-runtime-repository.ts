import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import {
  runtimeCuriosityResolutionEvents,
  runtimeSubjectStates,
} from "../../database/schema.js";
import {
  readCuriosityEvolution,
  resolveCuriosityEvolution,
  writeCuriosityEvolution,
} from "./curiosity-evolution.js";
import type {
  CuriosityResolutionResult,
  CuriosityResolutionRuntimePort,
} from "./curiosity-resolution.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

export class DrizzleCuriosityResolutionRuntimePort
implements CuriosityResolutionRuntimePort {
  constructor(private readonly db: Database) {}

  async resolve(input: {
    userId: string;
    subjectId: string;
    curiosityStateId: string;
    conversationId: string;
    resolutionSourceId: string;
    idempotencyKey: string;
    now: string;
  }): Promise<CuriosityResolutionResult> {
    const now = normalizeIso(input.now);

    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${input.userId + ":" + input.idempotencyKey},
            0
          )
        )
      `);

      const replay = await this.findEvent(
        transaction as Transaction,
        input.userId,
        input.idempotencyKey,
      );
      if (replay) {
        if (!matchesReplay(replay, input)) {
          return {
            outcome: "rejected" as const,
            code: "IDEMPOTENCY_CONFLICT" as const,
          };
        }
        return {
          outcome: "idempotent" as const,
          curiosityStateId: replay.curiosityStateId,
          resolvedAt: replay.resolvedAt,
          resolutionSourceId: replay.resultResolutionSourceId,
          updatedStates: 0,
        };
      }

      const [requested] = await transaction
        .select({
          id: runtimeSubjectStates.id,
          payload: runtimeSubjectStates.payload,
          settlementStatus: runtimeSubjectStates.settlementStatus,
          pathStatus: runtimeSubjectStates.pathStatus,
          validityStatus: runtimeSubjectStates.validityStatus,
        })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.id, input.curiosityStateId),
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            eq(runtimeSubjectStates.kind, "curiosity"),
          ),
        )
        .for("update")
        .limit(1);

      if (!requested) {
        return {
          outcome: "rejected" as const,
          code: "CURIOSITY_NOT_FOUND" as const,
        };
      }
      if (
        requested.settlementStatus !== "settled"
        || requested.pathStatus !== "current"
        || requested.validityStatus !== "valid"
      ) {
        return {
          outcome: "rejected" as const,
          code: "CURIOSITY_NOT_ELIGIBLE" as const,
        };
      }

      const anchor = readCuriosityEvolution(requested.payload);
      if (!anchor) {
        return {
          outcome: "rejected" as const,
          code: "CURIOSITY_NOT_EVOLVED" as const,
        };
      }
      if (
        anchor.role !== "anchor"
        || anchor.anchorStateId !== requested.id
      ) {
        return {
          outcome: "rejected" as const,
          code: "CURIOSITY_NOT_ELIGIBLE" as const,
        };
      }
      if (anchor.phase === "resolved") {
        const result = {
          outcome: "idempotent" as const,
          curiosityStateId: requested.id,
          resolvedAt: anchor.resolvedAt!,
          resolutionSourceId: anchor.resolutionSourceId!,
          updatedStates: 0,
        };
        await this.recordEvent(transaction as Transaction, input, result);
        return result;
      }
      if (anchor.phase !== "active") {
        return {
          outcome: "rejected" as const,
          code: "CURIOSITY_NOT_ACTIVE" as const,
        };
      }

      const rows = await transaction
        .select({
          id: runtimeSubjectStates.id,
          payload: runtimeSubjectStates.payload,
        })
        .from(runtimeSubjectStates)
        .where(
          and(
            eq(runtimeSubjectStates.userId, input.userId),
            eq(runtimeSubjectStates.subjectId, input.subjectId),
            eq(runtimeSubjectStates.kind, "curiosity"),
            eq(runtimeSubjectStates.settlementStatus, "settled"),
            eq(runtimeSubjectStates.pathStatus, "current"),
            eq(runtimeSubjectStates.validityStatus, "valid"),
            sql`${runtimeSubjectStates.payload} -> 'curiosity_v1' ->> 'anchorStateId' = ${requested.id}`,
          ),
        )
        .for("update");

      let updatedStates = 0;
      let resolvedAt: string | null = null;
      let resolutionSourceId: string | null = null;

      for (const row of rows) {
        const current = readCuriosityEvolution(row.payload);
        if (!current || current.anchorStateId !== requested.id) continue;
        const next = resolveCuriosityEvolution(current, {
          now,
          resolutionSourceId: input.resolutionSourceId,
        });
        resolvedAt = next.resolvedAt;
        resolutionSourceId = next.resolutionSourceId;

        const updated = await transaction
          .update(runtimeSubjectStates)
          .set({
            payload: writeCuriosityEvolution(row.payload, next),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(runtimeSubjectStates.id, row.id),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
              eq(runtimeSubjectStates.kind, "curiosity"),
              eq(runtimeSubjectStates.settlementStatus, "settled"),
              eq(runtimeSubjectStates.pathStatus, "current"),
              eq(runtimeSubjectStates.validityStatus, "valid"),
            ),
          )
          .returning({ id: runtimeSubjectStates.id });

        if (updated.length === 1) updatedStates += 1;
      }

      if (!resolvedAt || !resolutionSourceId || updatedStates < 1) {
        throw new Error("Curiosity resolution lost its evolved thread.");
      }

      const result = {
        outcome: "applied" as const,
        curiosityStateId: requested.id,
        resolvedAt,
        resolutionSourceId,
        updatedStates,
      };
      await this.recordEvent(transaction as Transaction, input, result);
      return result;
    });
  }

  private async findEvent(
    transaction: Transaction,
    userId: string,
    idempotencyKey: string,
  ): Promise<{
    subjectId: string;
    curiosityStateId: string;
    conversationId: string;
    requestedResolutionSourceId: string;
    resultResolutionSourceId: string;
    resolvedAt: string;
  } | null> {
    const [row] = await transaction
      .select({
        subjectId: runtimeCuriosityResolutionEvents.subjectId,
        curiosityStateId: runtimeCuriosityResolutionEvents.curiosityStateId,
        conversationId: runtimeCuriosityResolutionEvents.conversationId,
        requestedResolutionSourceId:
          runtimeCuriosityResolutionEvents.requestedResolutionSourceId,
        resultResolutionSourceId:
          runtimeCuriosityResolutionEvents.resultResolutionSourceId,
        resolvedAt: runtimeCuriosityResolutionEvents.resolvedAt,
      })
      .from(runtimeCuriosityResolutionEvents)
      .where(
        and(
          eq(runtimeCuriosityResolutionEvents.userId, userId),
          eq(runtimeCuriosityResolutionEvents.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row
      ? {
          ...row,
          resolvedAt: row.resolvedAt.toISOString(),
        }
      : null;
  }

  private async recordEvent(
    transaction: Transaction,
    input: {
      userId: string;
      subjectId: string;
      curiosityStateId: string;
      conversationId: string;
      resolutionSourceId: string;
      idempotencyKey: string;
    },
    result: {
      resolvedAt: string;
      resolutionSourceId: string;
    },
  ): Promise<void> {
    await transaction.insert(runtimeCuriosityResolutionEvents).values({
      userId: input.userId,
      subjectId: input.subjectId,
      curiosityStateId: input.curiosityStateId,
      conversationId: input.conversationId,
      requestedResolutionSourceId: input.resolutionSourceId,
      resultResolutionSourceId: result.resolutionSourceId,
      resolvedAt: new Date(result.resolvedAt),
      idempotencyKey: input.idempotencyKey,
    });
  }
}

function matchesReplay(
  event: {
    subjectId: string;
    curiosityStateId: string;
    conversationId: string;
    requestedResolutionSourceId: string;
  },
  input: {
    subjectId: string;
    curiosityStateId: string;
    conversationId: string;
    resolutionSourceId: string;
  },
): boolean {
  return event.subjectId === input.subjectId
    && event.curiosityStateId === input.curiosityStateId
    && event.conversationId === input.conversationId
    && event.requestedResolutionSourceId === input.resolutionSourceId;
}

function normalizeIso(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Curiosity resolution timestamp must be ISO.");
  }
  return new Date(parsed).toISOString();
}
