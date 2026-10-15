import { nativeResumeCheckpointSql } from "../turn/native-live-resume-checkpoint.js";
import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import type { NativeLiveExecutionAdmission } from "../protocol/native-live-execution-admission.js";

type Database = ReturnType<typeof createDatabase>["db"];
// A single SELECT observes reservation, live listener, canonical surface and
// checkpoint binding together. This grants no lasting lease and mutates nothing.
export async function checkNativeLiveExecutionAdmission(db: Pick<Database, "execute">, input: NativeLiveExecutionAdmission & { userId: string }): Promise<boolean> {
  const [row] = await db.execute<{ admitted: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM native_live_turn_preparations p
      JOIN conversations c ON c.user_id = p.user_id AND c.id = p.conversation_id
      JOIN native_live_runtime_listener_leases l ON l.user_id = p.user_id
        AND l.dispatch_target = 'claude_code' AND l.listener_instance_id = p.reserved_by
      LEFT JOIN conversation_messages u ON u.user_id = p.user_id
        AND u.conversation_id = p.conversation_id AND u.id = p.canonical_user_message_id
      WHERE p.user_id = ${input.userId}::uuid AND p.id = ${input.reservationId}::uuid
        AND p.reserved_by = ${input.listenerInstanceId}::uuid
        AND p.request_id = ${input.requestId}::uuid AND p.conversation_id = ${input.conversationId}::uuid
        AND p.runtime_mode = ${input.runtimeMode}
        AND p.canonical_user_message_id IS NOT DISTINCT FROM ${input.canonicalUserMessageId}::uuid
        AND p.parent_provider_session_id IS NOT DISTINCT FROM ${input.parentProviderSessionId}::text
        AND p.parent_provider_checkpoint_id IS NOT DISTINCT FROM ${input.parentProviderCheckpointId}::text
        AND p.status = 'prepared' AND p.dispatch_status = 'executing' AND p.execution_started_at IS NOT NULL
        AND p.reservation_expires_at > now() AND l.lease_expires_at > now()
        AND c.origin = 'native_live' AND c.lifecycle_status = 'active'
        AND coalesce(c.provider_metadata->'nativeSessionSource'->>'owner', 'leileios') = 'leileios'
        AND (
          (p.operation = 'send' AND u.role = 'user' AND c.current_head_message_id = u.id
            AND c.provider_metadata->'native_live_presentation_owner'->>'prepareId' = p.id::text
            AND (c.provider_metadata->'native_live_presentation_owner' ? 'anchorHeadMessageId')
            AND (c.provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId') IS NOT DISTINCT FROM c.current_head_message_id::text)
          OR (p.operation = 'wake' AND p.canonical_user_message_id IS NULL
            AND jsonb_typeof(p.wake_context->'runtime_generation') = 'object'
            AND (p.wake_context->'runtime_generation') ? 'source_revision'
            AND p.wake_context->'runtime_generation'->>'presentation_owner_id'
              = c.provider_metadata->'native_live_presentation_owner'->>'prepareId'
            AND (p.wake_context->'runtime_generation'->>'source_revision') IS NOT DISTINCT FROM
              (c.provider_metadata->'nativeSessionSource'->>'revision')
            AND p.wake_context->>'epoch_id' = p.wake_context->>'source_user_message_id'
            AND NOT EXISTS (
              SELECT 1 FROM native_live_turn_preparations foreground
              WHERE foreground.user_id = p.user_id AND foreground.id <> p.id
                AND foreground.status = 'prepared' AND foreground.operation <> 'wake'
                AND foreground.dispatch_status IN ('staged', 'pending', 'reserved', 'executing', 'delivery_unknown')
            )
            AND c.current_head_message_id::text = p.wake_context->>'source_head_message_id'
            AND p.wake_context->>'source_user_message_id' = (
              SELECT m.id::text FROM conversation_messages m
              JOIN conversations surface ON surface.id = m.conversation_id AND surface.user_id = m.user_id
              WHERE m.user_id = p.user_id AND m.role = 'user'
                AND surface.origin = 'native_live' AND surface.lifecycle_status = 'active'
              ORDER BY m.created_at DESC, m.id DESC LIMIT 1
            ))
        )
        AND (
          (p.runtime_mode = 'new' AND p.operation = 'send' AND u.parent_message_id IS NULL
            AND p.parent_provider_session_id IS NULL AND p.parent_provider_checkpoint_id IS NULL)
          OR (p.runtime_mode = 'resume' AND p.operation = 'send'
            AND u.parent_message_id IS NULL
            AND p.parent_provider_session_id = c.provider_metadata->'nativeSessionSource'->>'sessionId'
            AND p.parent_provider_checkpoint_id = c.provider_metadata->'nativeSessionSource'->>'checkpointId'
            AND p.expected_working_directory = c.provider_metadata->'nativeSessionSource'->>'effectiveWorkingDirectory'
            AND c.provider_metadata->'nativeSessionSource'->>'handoffMode' = 'native_checkpoint_only'
            AND c.provider_metadata->'nativeSessionSource'->>'owner' = 'leileios')
          OR (p.runtime_mode = 'resume' AND p.parent_provider_checkpoint_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM conversation_provider_session_checkpoints cp
              WHERE cp.user_id = p.user_id AND cp.conversation_id = p.conversation_id AND cp.provider = 'claude_code'
                AND cp.canonical_message_id = CASE WHEN p.operation = 'wake' THEN c.current_head_message_id ELSE u.parent_message_id END
                AND cp.provider_session_id = p.parent_provider_session_id
                AND ((p.operation = 'wake' AND ${nativeResumeCheckpointSql("cp", "c")} = p.parent_provider_checkpoint_id)
                  OR (p.operation = 'send' AND (cp.provider_checkpoint_id = p.parent_provider_checkpoint_id
                    OR ${nativeResumeCheckpointSql("cp", "c", false)} = p.parent_provider_checkpoint_id)))
                AND cp.effective_working_directory IS NOT DISTINCT FROM p.expected_working_directory
            ))
        )
    ) AS admitted
  `);
  return row?.admitted === true;
}
