import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";

type Database = ReturnType<typeof createDatabase>["db"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: string) => Object.assign(new Error(code), { code });

/** Native sessions LeileiOS still needs on the Mac: checkpoints (resume/fork
 * targets), conversation sources and in-flight turns. Archival must keep them. */
export async function listReferencedNativeSessions(db: Database, input: { userId: string }) {
  if (!uuid.test(input.userId)) throw fail("INVALID_NATIVE_PROJECTION");
  const rows = await db.execute<{ id: string }>(sql`
    SELECT provider_session_id AS id FROM conversation_provider_session_checkpoints WHERE user_id = ${input.userId}::uuid AND provider = 'claude_code'
    UNION SELECT provider_metadata->'nativeSessionSource'->>'sessionId' FROM conversations
      WHERE user_id = ${input.userId}::uuid AND lifecycle_status = 'active' AND provider_metadata ? 'nativeSessionSource'
    UNION SELECT parent_provider_session_id FROM native_live_turn_preparations WHERE user_id = ${input.userId}::uuid AND status = 'prepared'
    UNION SELECT provider_session_id FROM native_live_turn_preparations WHERE user_id = ${input.userId}::uuid AND status = 'prepared'`);
  return { sessionIds: rows.map(row => row.id).filter((id): id is string => typeof id === "string" && uuid.test(id)).sort() };
}

/** Owner-scoped selector metadata only: no messages, prompt, assets or write lease. */
export async function listNativeSessionSwitchChoices(db: Database, input: { userId: string }) {
  if (!uuid.test(input.userId)) throw fail("INVALID_NATIVE_PROJECTION");
  const rows = await db.execute(sql`
    SELECT c.id AS "conversationId", c.title, c.updated_at AS "updatedAt",
      c.current_head_message_id AS "headMessageId",
      CASE WHEN c.provider_metadata->'nativeSessionSource'->>'mode' = 'continuation'
        AND c.current_head_message_id::text IS NOT DISTINCT FROM (c.provider_metadata->'nativeSessionSource'->>'headMessageId')
        THEN c.provider_metadata->'nativeSessionSource'->>'sessionId' ELSE cp.provider_session_id END AS "providerSessionId",
      CASE WHEN c.provider_metadata->'nativeSessionSource'->>'mode' = 'continuation'
        AND c.current_head_message_id::text IS NOT DISTINCT FROM (c.provider_metadata->'nativeSessionSource'->>'headMessageId')
        THEN c.provider_metadata->'nativeSessionSource'->>'checkpointId' ELSE cp.provider_checkpoint_id END AS "providerCheckpointId",
      c.provider_metadata->'nativeSessionSource'->>'sessionId' AS "sourceSessionId",
      COALESCE(c.provider_metadata->'nativeSessionSource'->'lineage', '[]'::jsonb) AS "sourceLineage",
      EXISTS (SELECT 1 FROM native_live_turn_preparations t WHERE
        t.user_id = c.user_id AND t.conversation_id = c.id AND
        t.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')) AS busy
    FROM conversations c LEFT JOIN conversation_provider_session_checkpoints cp
      ON cp.user_id = c.user_id AND cp.conversation_id = c.id
      AND cp.canonical_message_id = c.current_head_message_id AND cp.provider = 'claude_code'
    WHERE c.user_id = ${input.userId}::uuid AND c.origin = 'native_live' AND c.lifecycle_status = 'active'
    ORDER BY c.updated_at DESC, c.id LIMIT 1001`);
  return { conversations: rows.slice(0, 1000), truncated: rows.length > 1000 };
}
