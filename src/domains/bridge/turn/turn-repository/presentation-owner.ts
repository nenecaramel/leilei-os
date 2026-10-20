import { sql, type SQL } from "drizzle-orm";
import { conversations } from "../../../../database/schema.js";

/**
 * A replacement may only recover/commit against the canonical head captured
 * by its preparation. Missing ownership evidence cannot authorize a purge.
 * Writers must evaluate this while holding the conversation row lock.
 */
export function matchesPresentationOwner(prepareId: string | SQL): SQL<boolean> {
  return sql<boolean>`EXISTS (SELECT 1 FROM native_live_session_owners o
    WHERE o.conversation_id=${conversations.id} AND o.user_id=${conversations.userId}
      AND o.turn_prepare_id::text=${prepareId}::text
      AND o.turn_anchor_message_id IS NOT DISTINCT FROM ${conversations.currentHeadMessageId})`;
}
