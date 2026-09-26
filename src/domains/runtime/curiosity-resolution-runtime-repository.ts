import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { runtimeSubjectStates } from "../../database/schema.js";
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

export class DrizzleCuriosityResolutionRuntimePort
implements CuriosityResolutionRuntimePort {
  constructor(private readonly db: Database) {}

  async resolve(input: {
    userId: string;
    subjectId: string;
    curiosityStateId: string;
    resolutionSourceId: string;
    now: string;
  }): Promise<CuriosityResolutionResult> {
    return this.db.transaction(async (transaction) => {
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
        return {
          outcome: "idempotent" as const,
          curiosityStateId: requested.id,
          resolvedAt: anchor.resolvedAt!,
          resolutionSourceId: anchor.resolutionSourceId!,
          updatedStates: 0,
        };
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
          now: input.now,
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

      return {
        outcome: "applied" as const,
        curiosityStateId: requested.id,
        resolvedAt,
        resolutionSourceId,
        updatedStates,
      };
    });
  }
}
