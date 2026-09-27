import { and, asc, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";
import { runtimeSubjectStates } from "../../database/schema.js";
import type {
  TopicResurfaceCandidatePort,
  TopicResurfaceCandidateRow,
} from "./topic-resurface-candidates.js";

type Database = ReturnType<typeof createDatabase>["db"];

export class DrizzleTopicResurfaceCandidatePort
implements TopicResurfaceCandidatePort {
  constructor(private readonly db: Database) {}

  async listDormantAnchors(input: {
    userId: string;
    subjectId: string;
    limit: number;
  }): Promise<TopicResurfaceCandidateRow[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1) {
      throw new Error(
        "Topic resurface candidate limit must be a positive integer.",
      );
    }

    const rows = await this.db
      .select({
        id: runtimeSubjectStates.id,
        text: runtimeSubjectStates.text,
        payload: runtimeSubjectStates.payload,
      })
      .from(runtimeSubjectStates)
      .where(
        and(
          eq(runtimeSubjectStates.userId, input.userId),
          eq(runtimeSubjectStates.subjectId, input.subjectId),
          eq(runtimeSubjectStates.kind, "topic"),
          sql`${runtimeSubjectStates.envelope} ->> 'authority' = 'derived'`,
          eq(runtimeSubjectStates.scopeApplicability, "global"),
          eq(runtimeSubjectStates.settlementStatus, "settled"),
          eq(runtimeSubjectStates.pathStatus, "current"),
          eq(runtimeSubjectStates.validityStatus, "valid"),
          sql`${runtimeSubjectStates.payload} -> 'topic_v1' ->> 'phase'
            = 'dormant'`,
          sql`${runtimeSubjectStates.payload} -> 'topic_v1' ->> 'role'
            = 'anchor'`,
          sql`NOT EXISTS (
            SELECT 1
            FROM runtime_subject_states materialized
            WHERE materialized.user_id = ${input.userId}::uuid
              AND materialized.subject_id = ${input.subjectId}
              AND materialized.kind = 'thought'
              AND materialized.payload
                -> 'thought_seed_v1' ->> 'source_kind'
                = 'topic_resurface'
              AND materialized.payload
                -> 'thought_seed_v1' ->> 'source_state_id'
                = ${runtimeSubjectStates.id}::text
              AND materialized.payload
                -> 'thought_seed_v1' ->> 'source_evidence_id'
                = (
                  ${runtimeSubjectStates.payload}
                    -> 'topic_v1'
                    -> 'reinforcementSources'
                    ->> -1
                )
          )`,
        ),
      )
      // Stable identity order only. This is not a preference/ranking signal.
      // A Topic generation that already produced its derived Thought is
      // ineligible before LIMIT, so completed rows cannot starve later work.
      .orderBy(asc(runtimeSubjectStates.id))
      .limit(input.limit);

    return rows.flatMap((row) => {
      const text = row.text?.trim();
      if (!text) return [];
      return [{
        stateId: row.id,
        text,
        payload: row.payload,
      }];
    });
  }
}
