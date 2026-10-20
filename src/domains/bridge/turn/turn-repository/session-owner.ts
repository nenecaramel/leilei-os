import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../../database/client.js";

// Any database or transaction handle; only raw SQL is used.
type Executor = Pick<ReturnType<typeof createDatabase>["db"], "execute">;

const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/**
 * Shadow write of `native_live_session_owners` (docs/native-session/session-owner.md, PR 1).
 * Owner, revision and turn slot mirror the conversation JSON exactly. Only the
 * writer generation has its own rule: created once, rotated only on request.
 * Call inside the transaction that wrote the JSON, after that write.
 */
export async function syncNativeSessionOwner(executor: Executor, input: {
  userId: string; conversationId: string; rotateGeneration?: boolean;
}): Promise<string | null> {
  const slot = sql`c.provider_metadata->'native_live_presentation_owner'`;
  const slotOwner = sql`CASE WHEN ${slot}->>'prepareId' ~* ${uuidPattern} THEN (${slot}->>'prepareId')::uuid END`;
  const rows = await executor.execute<{ writer_generation: string }>(sql`
    INSERT INTO native_live_session_owners AS o
      (conversation_id, user_id, owner, owner_revision, writer_generation, turn_prepare_id, turn_anchor_message_id, updated_at)
    SELECT c.id, c.user_id,
      CASE WHEN c.provider_metadata->'nativeSessionSource'->>'owner' = 'desktop' THEN 'desktop' ELSE 'leileios' END,
      c.provider_metadata->'nativeSessionSource'->>'revision',
      gen_random_uuid(),
      ${slotOwner},
      CASE WHEN ${slotOwner} IS NOT NULL AND ${slot}->>'anchorHeadMessageId' ~* ${uuidPattern}
        THEN (${slot}->>'anchorHeadMessageId')::uuid END,
      now()
    FROM conversations c
    WHERE c.id = ${input.conversationId}::uuid AND c.user_id = ${input.userId}::uuid AND c.origin = 'native_live'
    ON CONFLICT (conversation_id) DO UPDATE SET
      owner = EXCLUDED.owner,
      owner_revision = EXCLUDED.owner_revision,
      turn_prepare_id = EXCLUDED.turn_prepare_id,
      turn_anchor_message_id = EXCLUDED.turn_anchor_message_id,
      writer_generation = CASE WHEN ${input.rotateGeneration === true} THEN gen_random_uuid() ELSE o.writer_generation END,
      updated_at = now()
    RETURNING writer_generation::text
  `);
  return rows[0]?.writer_generation ?? null;
}

export async function readNativeWriterGeneration(executor: Executor, input: {
  userId: string; conversationId: string;
}): Promise<string | null> {
  const [row] = await executor.execute<{ writer_generation: string }>(sql`
    SELECT writer_generation::text FROM native_live_session_owners
    WHERE conversation_id = ${input.conversationId}::uuid AND user_id = ${input.userId}::uuid
  `);
  return row?.writer_generation ?? null;
}

/** A committed turn starts a new native line unless it resumes the head. Wake never does. */
export function commitRotatesWriterGeneration(row: { operation: string; runtimeMode: string }): boolean {
  return row.operation !== "wake" && row.runtimeMode !== "resume";
}
