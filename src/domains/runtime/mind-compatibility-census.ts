import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";

type Database = ReturnType<typeof createDatabase>["db"];

export type MindCompatibilityCensus = {
  legacyDreamStates: number;
  legacyAuthoredTopicStates: number;
  legacyMemoryRecallWithoutLedger: number;
  legacyOpenMindFollowUps: number;
  legacyOpenDreamIntents: number;
  legacyOpenTopicIntents: number;
  quarantinedMindFollowUps: number;
};

type StateCensusRow = {
  legacy_dream_states: number;
  legacy_authored_topic_states: number;
  legacy_memory_recall_without_ledger: number;
};

type FollowUpCensusRow = {
  legacy_open_mind_followups: number;
  legacy_open_dream_intents: number;
  legacy_open_topic_intents: number;
  quarantined_mind_followups: number;
};

export class MindCompatibilityCensusService {
  constructor(private readonly db: Database) {}

  async read(input: {
    userId: string;
    subjectId: string;
  }): Promise<MindCompatibilityCensus> {
    const stateRows = await this.db.execute<StateCensusRow>(sql`
      SELECT
        count(*) FILTER (
          WHERE kind = 'dream'
        )::int AS legacy_dream_states,
        count(*) FILTER (
          WHERE kind = 'topic'
            AND envelope ->> 'authority' = 'subject_authorized'
        )::int AS legacy_authored_topic_states,
        count(*) FILTER (
          WHERE kind = 'memory'
            AND payload -> 'lifecycle_v1' ->> 'lastRecalledAt' IS NOT NULL
            AND NOT (payload ? 'recall_reinforcement_v1')
        )::int AS legacy_memory_recall_without_ledger
      FROM runtime_subject_states
      WHERE user_id = ${input.userId}::uuid
        AND subject_id = ${input.subjectId}
    `);

    const followUpRows = await this.db.execute<FollowUpCensusRow>(sql`
      SELECT
        count(*) FILTER (
          WHERE status IN ('pending', 'processing')
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(intents) AS intent
              WHERE intent ->> 'kind' IN ('dream', 'topic')
            )
        )::int AS legacy_open_mind_followups,
        count(*) FILTER (
          WHERE status IN ('pending', 'processing')
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(intents) AS intent
              WHERE intent ->> 'kind' = 'dream'
            )
        )::int AS legacy_open_dream_intents,
        count(*) FILTER (
          WHERE status IN ('pending', 'processing')
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(intents) AS intent
              WHERE intent ->> 'kind' = 'topic'
            )
        )::int AS legacy_open_topic_intents,
        count(*) FILTER (
          WHERE status = 'quarantined'
        )::int AS quarantined_mind_followups
      FROM native_live_mind_followups
      WHERE user_id = ${input.userId}::uuid
    `);

    const state = stateRows[0];
    const followUp = followUpRows[0];
    if (!state || !followUp) {
      throw new Error("Mind compatibility census query returned no aggregate row.");
    }

    return {
      legacyDreamStates: state.legacy_dream_states,
      legacyAuthoredTopicStates: state.legacy_authored_topic_states,
      legacyMemoryRecallWithoutLedger:
        state.legacy_memory_recall_without_ledger,
      legacyOpenMindFollowUps: followUp.legacy_open_mind_followups,
      legacyOpenDreamIntents: followUp.legacy_open_dream_intents,
      legacyOpenTopicIntents: followUp.legacy_open_topic_intents,
      quarantinedMindFollowUps: followUp.quarantined_mind_followups,
    };
  }
}
