import { and, asc, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { runtimeSubjectStates } from "../../database/schema.js";
import type { PersistentWriteEnvelope } from "./persistent-write-envelope.js";
import { DrizzleSubjectStateRuntimePort } from "./subject-state-runtime-repository.js";
import type { SubjectStateWrite } from "./subject-state-contract.js";
import type {
  CuriosityTopicProjectionRuntimePort,
  CuriosityTopicSeedCandidate,
} from "./curiosity-topic-projection.js";
import { readCuriosityEvolution } from "./curiosity-evolution.js";

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleCuriosityTopicProjectionRuntimePort
implements CuriosityTopicProjectionRuntimePort {
  private readonly subjectStates: DrizzleSubjectStateRuntimePort;

  constructor(private readonly db: Database) {
    this.subjectStates = new DrizzleSubjectStateRuntimePort(db);
  }

  async listCandidates(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<CuriosityTopicSeedCandidate[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error(
        "Curiosity topic projection candidate limit must be positive.",
      );
    }

    const rows = await this.db
      .select({
        id: runtimeSubjectStates.id,
        text: runtimeSubjectStates.text,
        payload: runtimeSubjectStates.payload,
        envelope: runtimeSubjectStates.envelope,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          eq(runtimeSubjectStates.kind, "curiosity"),
          eq(runtimeSubjectStates.scopeApplicability, "global"),
          eq(runtimeSubjectStates.settlementStatus, "settled"),
          eq(runtimeSubjectStates.pathStatus, "current"),
          eq(runtimeSubjectStates.validityStatus, "valid"),
          sql`COALESCE(
            ${runtimeSubjectStates.payload} -> 'curiosity_v1' ->> 'phase',
            'active'
          ) = 'active'`,
          sql`NOT EXISTS (
            SELECT 1
            FROM runtime_subject_states projected
            WHERE projected.user_id = ${input.userId}::uuid
              AND projected.subject_id = ${input.subjectId}
              AND projected.kind = 'topic'
              AND projected.payload -> 'topic_seed_v1' ->> 'source_kind'
                = 'curiosity'
              AND projected.payload -> 'topic_seed_v1' ->> 'source_state_id'
                = ${runtimeSubjectStates.id}::text
          )`,
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
      try {
        const evolution = readCuriosityEvolution(row.payload);
        if (evolution && evolution.phase !== "active") return [];
      } catch {
        return [];
      }
      const envelope =
        row.envelope as unknown as PersistentWriteEnvelope;
      const causedBy = envelope.provenance.causedBy?.trim();
      if (!causedBy) return [];

      return [{
        stateId: row.id,
        text,
        visibility: envelope.scope.visibility,
        sensitivity: envelope.scope.sensitivity,
        audience: [...envelope.scope.audience],
        causedBy,
      }];
    });
  }

  appendTopics(input: {
    userId: string;
    subjectId: string;
    topics: readonly SubjectStateWrite[];
  }): Promise<void> {
    return this.subjectStates.append({
      userId: input.userId,
      subjectId: input.subjectId,
      states: [...input.topics],
    });
  }
}
