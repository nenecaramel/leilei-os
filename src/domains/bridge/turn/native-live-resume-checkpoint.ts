import { nativeSessionExecutableSql } from "./turn-repository/session-owner.js";
import { sql, type SQL } from "drizzle-orm";
import type { Executor } from "./turn-repository/types.js";

// A hidden native continuation does not replace the canonical branch checkpoint.
// The cursor is usable only against the same binding. Preparation resolution
// additionally checks the presentation generation; admission checks its already
// persisted parent against this cursor under its separate head/owner fences.
export function nativeResumeCheckpointSql(checkpointAlias: string, conversationAlias: string, enforceGeneration = true): SQL<string | null> {
  const cp = sql.identifier(checkpointAlias), conversation = sql.identifier(conversationAlias);
  const tail = sql`${cp}.runtime_metadata->'native_live_resume_tail'`;
  return sql<string | null>`CASE WHEN
    jsonb_typeof(${tail}) = 'object'
    AND ${tail}->>'canonical_message_id' = ${cp}.canonical_message_id::text
    AND ${tail}->>'provider_session_id' = ${cp}.provider_session_id
    AND ${tail}->>'base_checkpoint_id' = ${cp}.provider_checkpoint_id
    AND (${tail}->>'cwd') IS NOT DISTINCT FROM ${cp}.effective_working_directory
    AND ${tail}->>'checkpoint_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND ${tail}->>'checkpoint_id' <> '00000000-0000-0000-0000-000000000000'
    AND (${tail}->>'source_revision') IS NOT DISTINCT FROM (${conversation}.provider_metadata->'nativeSessionSource'->>'revision')
    AND ${nativeSessionExecutableSql(conversationAlias)}
    ${enforceGeneration ? sql`AND coalesce(${tail}->>'writer_generation', ${tail}->>'presentation_owner_id') = (
      SELECT o.writer_generation::text FROM native_live_session_owners o
      WHERE o.conversation_id=${conversation}.id AND o.user_id=${conversation}.user_id
    )` : sql``}
    THEN ${tail}->>'checkpoint_id' ELSE ${cp}.provider_checkpoint_id END`;
}

export async function readNativeResumeCheckpoint(db: Executor, input: { userId: string; conversationId: string; canonicalMessageId: string }): Promise<string | null> {
  const [row] = await db.execute<{ checkpoint: string | null }>(sql`
    SELECT ${nativeResumeCheckpointSql("cp", "c")} AS checkpoint
    FROM conversation_provider_session_checkpoints cp
    JOIN conversations c ON c.id = cp.conversation_id AND c.user_id = cp.user_id
    WHERE cp.user_id = ${input.userId}::uuid AND cp.conversation_id = ${input.conversationId}::uuid
      AND cp.canonical_message_id = ${input.canonicalMessageId}::uuid AND cp.provider = 'claude_code'
      AND c.origin = 'native_live' AND c.lifecycle_status = 'active'
      AND c.current_head_message_id = cp.canonical_message_id
    LIMIT 1
  `);
  return row?.checkpoint ?? null;
}
