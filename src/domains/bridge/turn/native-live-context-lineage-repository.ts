import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import {
  normalizeContextLineageState,
  type ContextLineageState,
} from "../../runtime/context/context-lineage.js";

type Database = ReturnType<typeof createDatabase>["db"];

export interface NativeLiveContextLineageReader {
  readForMessage(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string | null;
  }): Promise<ContextLineageState>;
}

export class DrizzleNativeLiveContextLineageReader
implements NativeLiveContextLineageReader {
  constructor(private readonly db: Database) {}

  async readForMessage(input: {
    userId: string;
    conversationId: string;
    canonicalMessageId: string | null;
  }): Promise<ContextLineageState> {
    if (!input.canonicalMessageId) {
      return normalizeContextLineageState(null);
    }

    const rows = await this.db.execute<{
      epoch: number;
      seen_state_ids: string[];
      thought_revision: number;
      thought_fingerprint: string | null;
    }>(sql`
      WITH RECURSIVE current_path AS (
        SELECT
          message.id,
          message.parent_message_id,
          0 AS depth
        FROM conversation_messages AS message
        WHERE message.id = ${input.canonicalMessageId}::uuid
          AND message.user_id = ${input.userId}::uuid
          AND message.conversation_id = ${input.conversationId}::uuid

        UNION ALL

        SELECT
          parent.id,
          parent.parent_message_id,
          path.depth + 1
        FROM conversation_messages AS parent
        INNER JOIN current_path AS path
          ON parent.id = path.parent_message_id
        WHERE parent.user_id = ${input.userId}::uuid
          AND parent.conversation_id = ${input.conversationId}::uuid
      )
      SELECT
        lineage.epoch,
        lineage.seen_state_ids,
        lineage.thought_revision,
        lineage.thought_fingerprint
      FROM current_path AS path
      INNER JOIN runtime_context_lineage_states AS lineage
        ON lineage.canonical_message_id = path.id
       AND lineage.user_id = ${input.userId}::uuid
       AND lineage.conversation_id = ${input.conversationId}::uuid
      ORDER BY path.depth ASC
      LIMIT 1
    `);
    const row = rows[0];

    if (!row) {
      return normalizeContextLineageState({
        epoch: 0,
        seenStateIds: [],
        thoughtRevision: 0,
        thoughtFingerprint: null,
        forceThoughtSnapshot: true,
      });
    }

    return normalizeContextLineageState({
      epoch: Number(row.epoch),
      seenStateIds: row.seen_state_ids,
      thoughtRevision: Number(row.thought_revision),
      thoughtFingerprint: row.thought_fingerprint,
      ...(row.thought_fingerprint === null
        ? { forceThoughtSnapshot: true }
        : {}),
    });
  }
}
