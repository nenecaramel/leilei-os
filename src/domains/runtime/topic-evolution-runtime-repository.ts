import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { runtimeSubjectStates } from "../../database/schema.js";
import type {
  TopicEvolutionCandidate,
  TopicEvolutionRuntimePort,
  TopicEvolutionUpdate,
} from "./topic-evolution.js";

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleTopicEvolutionRuntimePort
implements TopicEvolutionRuntimePort {
  constructor(private readonly db: Database) {}

  async listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<TopicEvolutionCandidate[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error("Topic evolution candidate limit must be positive.");
    }

    const rows = await this.db
      .select({
        id: runtimeSubjectStates.id,
        text: runtimeSubjectStates.text,
        payload: runtimeSubjectStates.payload,
        envelope: runtimeSubjectStates.envelope,
        createdAt: runtimeSubjectStates.createdAt,
        updatedAt: runtimeSubjectStates.updatedAt,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          eq(runtimeSubjectStates.kind, "topic"),
          sql`${runtimeSubjectStates.envelope} ->> 'authority' = 'derived'`,
          eq(runtimeSubjectStates.settlementStatus, "settled"),
          eq(runtimeSubjectStates.pathStatus, "current"),
          eq(runtimeSubjectStates.validityStatus, "valid"),
        ),
      )
      .orderBy(
        asc(runtimeSubjectStates.createdAt),
        asc(runtimeSubjectStates.id),
      )
      .limit(input.limit);

    return rows.flatMap((row) => {
      const text = row.text?.trim();
      if (!text) return [];
      return [{
        stateId: row.id,
        text,
        payload: row.payload,
        sourceId: sourceIdFromEnvelope(row.envelope, row.id),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }];
    });
  }

  async applyUpdates(input: {
    userId: string;
    subjectId: string;
    updates: readonly TopicEvolutionUpdate[];
  }): Promise<{ applied: number; conflicts: number }> {
    if (input.updates.length === 0) {
      return { applied: 0, conflicts: 0 };
    }

    return this.db.transaction(async (transaction) => {
      let applied = 0;
      let conflicts = 0;

      for (const update of input.updates) {
        const [current] = await transaction
          .select({
            id: runtimeSubjectStates.id,
            payload: runtimeSubjectStates.payload,
            updatedAt: runtimeSubjectStates.updatedAt,
          })
          .from(runtimeSubjectStates)
          .where(
            and(
              eq(runtimeSubjectStates.id, update.stateId),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
              eq(runtimeSubjectStates.kind, "topic"),
              eq(runtimeSubjectStates.settlementStatus, "settled"),
              eq(runtimeSubjectStates.pathStatus, "current"),
              eq(runtimeSubjectStates.validityStatus, "valid"),
            ),
          )
          .for("update")
          .limit(1);

        if (
          !current
          || current.updatedAt.toISOString() !== update.expectedUpdatedAt
          || !isDeepStrictEqual(current.payload, update.expectedPayload)
        ) {
          conflicts += 1;
          continue;
        }

        const rows = await transaction
          .update(runtimeSubjectStates)
          .set({
            payload: update.nextPayload,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(runtimeSubjectStates.id, update.stateId),
              eq(runtimeSubjectStates.userId, input.userId),
              eq(runtimeSubjectStates.subjectId, input.subjectId),
              eq(runtimeSubjectStates.kind, "topic"),
              eq(runtimeSubjectStates.settlementStatus, "settled"),
              eq(runtimeSubjectStates.pathStatus, "current"),
              eq(runtimeSubjectStates.validityStatus, "valid"),
            ),
          )
          .returning({ id: runtimeSubjectStates.id });

        if (rows.length === 1) applied += 1;
        else conflicts += 1;
      }

      return { applied, conflicts };
    });
  }
}

function sourceIdFromEnvelope(
  envelope: Record<string, unknown>,
  fallback: string,
): string {
  const provenance = envelope.provenance;
  if (
    provenance
    && typeof provenance === "object"
    && !Array.isArray(provenance)
  ) {
    const causedBy = (provenance as Record<string, unknown>).causedBy;
    if (typeof causedBy === "string" && causedBy.trim()) {
      return causedBy;
    }
  }
  return fallback;
}
