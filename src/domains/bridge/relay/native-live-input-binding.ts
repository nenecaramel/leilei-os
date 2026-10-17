import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { conversationMessages, nativeLiveTurnPreparations } from "../../../database/schema.js";
import type { NativeLiveExecutionAdmission } from "../protocol/native-live-execution-admission.js";
import { hashJson } from "../turn/turn-repository/records.js";
import { nativeResumeCheckpointSql } from "../turn/native-live-resume-checkpoint.js";

type Database = ReturnType<typeof createDatabase>["db"];
export type NativeLiveInputBindingRequest = NativeLiveExecutionAdmission & { phase: "queued" | "started" };
export type NativeLiveInputBinding = { userMessageId: string; parentProviderCheckpointId: string | null };
const identityHash = (i: NativeLiveExecutionAdmission & { userId: string }) => hashJson("native-input-binding-v1", {
  userId:i.userId,reservationId:i.reservationId,listenerInstanceId:i.listenerInstanceId,requestId:i.requestId,conversationId:i.conversationId,
  runtimeMode:i.runtimeMode,canonicalUserMessageId:i.canonicalUserMessageId,parentProviderSessionId:i.parentProviderSessionId,parentProviderCheckpointId:i.parentProviderCheckpointId,
});
type Marker = { identity: string; sourceRevision: string | null; started: boolean; parentProviderCheckpointId: string | null };

// Lease maintenance for a queued input is not authorization to generate or use
// tools. The latter still requires the immutable started binding.
export async function checkQueuedNativeLiveInput(db: Pick<Database, "execute">, input: NativeLiveExecutionAdmission & { userId: string }) {
  const digest = identityHash(input);
  const [row] = await db.execute(sql`SELECT p.id FROM native_live_turn_preparations p
    JOIN conversations c ON c.id=p.conversation_id AND c.user_id=p.user_id
    JOIN native_live_runtime_listener_leases l ON l.user_id=p.user_id AND l.dispatch_target='claude_code'
    WHERE p.user_id=${input.userId}::uuid AND p.id=${input.reservationId}::uuid AND p.reserved_by=${input.listenerInstanceId}::uuid
      AND p.status='prepared' AND p.dispatch_status='executing' AND p.reservation_expires_at>clock_timestamp()
      AND l.listener_instance_id=p.reserved_by AND l.lease_expires_at>clock_timestamp()
      AND p.runtime_metadata->'native_live_input_binding'->>'identity'=${digest}
      AND p.runtime_metadata->'native_live_input_binding'->>'started'='false'
      AND (p.runtime_metadata->'native_live_input_binding'->>'sourceRevision') IS NOT DISTINCT FROM (c.provider_metadata->'nativeSessionSource'->>'revision')
      AND c.origin='native_live' AND c.lifecycle_status='active'
      AND coalesce(c.provider_metadata->'nativeSessionSource'->>'owner','leileios')='leileios'
      AND c.provider_metadata->'native_live_presentation_owner'->>'prepareId'=p.id::text
      AND (c.provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId') IS NOT DISTINCT FROM c.current_head_message_id::text LIMIT 1`);
  return !!row;
}

/** Only a native command_lifecycle.started receipt may request phase=started.
 * A queued user row is detached from canonical history. Bind it once, under the
 * same head/lease lock as background publication; never move a published row.
 */
export async function bindNativeLiveInput(db: Database, input: NativeLiveInputBindingRequest & { userId: string }): Promise<NativeLiveInputBinding | null> {
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout='5s'`);
    await tx.execute(sql`SET LOCAL lock_timeout='2s'`);
    const [p] = await tx.select().from(nativeLiveTurnPreparations).where(and(
      eq(nativeLiveTurnPreparations.userId, input.userId), eq(nativeLiveTurnPreparations.id, input.reservationId),
    )).for("update").limit(1);
    if (!p || p.operation !== "send" || p.status !== "prepared" || p.dispatchStatus !== "executing"
      || !p.executionStartedAt || p.reservedBy !== input.listenerInstanceId || p.requestId !== input.requestId
      || p.conversationId !== input.conversationId || p.runtimeMode !== input.runtimeMode
      || !p.canonicalUserMessageId || p.canonicalUserMessageId !== input.canonicalUserMessageId
      || p.parentProviderSessionId !== input.parentProviderSessionId || !p.reservationExpiresAt
      || p.reservationExpiresAt.getTime() <= Date.now()) return null;
    const [c] = await tx.execute<{ head: string | null; revision: string | null }>(sql`
      SELECT current_head_message_id::text AS head, provider_metadata->'nativeSessionSource'->>'revision' AS revision
      FROM conversations WHERE user_id=${input.userId}::uuid AND id=${p.conversationId}::uuid
        AND origin='native_live' AND lifecycle_status='active'
        AND coalesce(provider_metadata->'nativeSessionSource'->>'owner','leileios')='leileios'
        AND provider_metadata->'native_live_presentation_owner'->>'prepareId'=${p.id}::text
        AND (provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId') IS NOT DISTINCT FROM current_head_message_id::text
      FOR UPDATE
    `);
    const [lease] = c ? await tx.execute(sql`SELECT user_id FROM native_live_runtime_listener_leases
      WHERE user_id=${input.userId}::uuid AND dispatch_target='claude_code'
        AND listener_instance_id=${input.listenerInstanceId}::uuid AND lease_expires_at>clock_timestamp() FOR SHARE`) : [];
    if (!c || !lease) return null;
    const digest = identityHash(input);
    const marker = p.runtimeMetadata?.native_live_input_binding as Marker | undefined;
    if (marker && (marker.identity !== digest || marker.sourceRevision !== c.revision)) return null;
    if (marker?.started) return { userMessageId: p.canonicalUserMessageId, parentProviderCheckpointId: marker.parentProviderCheckpointId };
    if (p.parentProviderCheckpointId !== input.parentProviderCheckpointId) return null;
    const [u] = await tx.select().from(conversationMessages).where(and(
      eq(conversationMessages.userId, input.userId), eq(conversationMessages.conversationId, p.conversationId),
      eq(conversationMessages.id, p.canonicalUserMessageId),
    )).for("update").limit(1);
    if (!u || u.role !== "user" || c.head === u.id || u.parentMessageId !== c.head) return null;
    // The accepted U->H parent is immutable. Native background B that runs
    // before F starts must remain QUEUED and later be published after F;
    // reparenting U under an already-visible B would show H->B->U->F.
    const [used] = await tx.execute(sql`SELECT 1 FROM conversation_messages WHERE user_id=${input.userId}::uuid
      AND conversation_id=${p.conversationId}::uuid AND parent_message_id=${u.id}::uuid
      UNION ALL SELECT 1 FROM conversation_provider_session_checkpoints WHERE user_id=${input.userId}::uuid AND canonical_message_id=${u.id}::uuid LIMIT 1`);
    if (used) return null;
    // Only server-committed background descendants can intervene. An ordinary
    // send, replacement, import or unrelated native branch is not rebindable.
    const [suffix] = await tx.execute<{ safe: boolean }>(sql`
      WITH RECURSIVE suffix AS (
        SELECT m.id,m.parent_message_id,0 AS depth,ARRAY[m.id] AS visited FROM conversation_messages m
          WHERE m.user_id=${input.userId}::uuid AND m.conversation_id=${p.conversationId}::uuid AND m.id=${c.head}::uuid
        UNION ALL SELECT m.id,m.parent_message_id,s.depth+1,s.visited||m.id FROM suffix s
          JOIN conversation_messages m ON m.id=s.parent_message_id
          WHERE m.user_id=${input.userId}::uuid AND m.conversation_id=${p.conversationId}::uuid
            AND s.id IS DISTINCT FROM ${u.parentMessageId}::uuid AND s.depth<4095 AND NOT m.id=ANY(s.visited)
      ) SELECT (
        ${c.head}::uuid IS NOT DISTINCT FROM ${u.parentMessageId}::uuid OR (
          EXISTS(SELECT 1 FROM suffix WHERE id=${u.parentMessageId}::uuid)
          AND NOT EXISTS(SELECT 1 FROM suffix s LEFT JOIN conversation_provider_session_checkpoints cp
            ON cp.canonical_message_id=s.id AND cp.user_id=${input.userId}::uuid AND cp.conversation_id=${p.conversationId}::uuid AND cp.provider='claude_code'
            WHERE s.id IS DISTINCT FROM ${u.parentMessageId}::uuid AND (
              cp.provider_session_id IS DISTINCT FROM ${p.parentProviderSessionId}::text
              OR cp.runtime_metadata->'native_live_background_receipt'->>'phase' IS DISTINCT FROM 'committed'
              OR (cp.runtime_metadata->'native_live_generation'->>'source_revision') IS DISTINCT FROM ${c.revision}::text))
        )) AS safe
    `);
    if (!suffix?.safe) return null;
    const [cp] = await tx.execute<{ checkpoint: string | null; session: string; cwd: string | null }>(sql`
      SELECT ${nativeResumeCheckpointSql("cp", "c", false)} AS checkpoint,cp.provider_session_id AS session,cp.effective_working_directory AS cwd
      FROM conversation_provider_session_checkpoints cp JOIN conversations c ON c.id=cp.conversation_id AND c.user_id=cp.user_id
      WHERE cp.user_id=${input.userId}::uuid AND cp.conversation_id=${p.conversationId}::uuid
        AND cp.canonical_message_id=${c.head}::uuid AND cp.provider='claude_code' LIMIT 1
    `);
    if (p.runtimeMode === "resume" && (!cp || cp.session !== p.parentProviderSessionId || cp.cwd !== p.expectedWorkingDirectory || !cp.checkpoint)) return null;
    if (p.runtimeMode === "new" && (c.head !== null || u.parentMessageId !== null)) return null;
    let startedCheckpoint = cp?.checkpoint ?? null;
    if (input.phase === "started") {
      const [busy] = await tx.execute(sql`SELECT 1 FROM native_live_runtime_events e
        JOIN native_live_turn_preparations source ON source.id=e.prepare_id AND source.user_id=e.user_id
        WHERE e.user_id=${input.userId}::uuid AND source.conversation_id=${p.conversationId}::uuid
          AND e.payload->>'kind'='persistent_background_receipt_v1' AND e.payload->>'phase'='prepared'
          AND e.payload->>'executionStart'='true' AND (e.payload->>'expiresAt')::timestamptz>clock_timestamp() LIMIT 1`);
      if (busy) return null;
      // The Mac writer has acknowledged each pre-start B only as queued
      // transport custody, so the canonical head is still H. The native
      // stream can already be at B2: bind the actual last producer cursor
      // while preserving U's original canonical parent H. Producer chaining
      // was checked when preparing the immutable B receipts.
      const [tail] = await tx.execute<{ checkpoint: string }>(sql`
        SELECT e.payload->'result'->>'provider_checkpoint_id' AS checkpoint
        FROM native_live_runtime_events e
        JOIN native_live_turn_preparations source
          ON source.id=e.prepare_id AND source.user_id=e.user_id
        WHERE e.user_id=${input.userId}::uuid
          AND source.conversation_id=${p.conversationId}::uuid
          AND source.assistant_message_id=${c.head}::uuid
          AND source.status='finalized_success' AND source.dispatch_status='completed'
          AND e.payload->>'kind'='persistent_background_receipt_v1'
          AND e.payload->>'phase'='queued'
          AND e.payload->>'executionStart'='true'
          AND e.payload->>'deferred'='true'
          AND e.payload->'identity'->>'listenerInstanceId'=${input.listenerInstanceId}
          AND e.payload->'context'->>'presentationOwnerId'=${p.id}::text
          AND e.payload->'context'->>'providerSessionId'=${p.parentProviderSessionId}
          AND e.payload->'context'->>'sourceRevision' IS NOT DISTINCT FROM ${c.revision}
          AND e.payload->'context'->>'cwd' IS NOT DISTINCT FROM ${p.expectedWorkingDirectory}
        ORDER BY e.sequence DESC LIMIT 1
      `);
      if (tail?.checkpoint) startedCheckpoint = tail.checkpoint;
    }
    const bound: Marker = { identity: digest, sourceRevision: c.revision, started: input.phase === "started",
      parentProviderCheckpointId: input.phase === "started" ? startedCheckpoint : p.parentProviderCheckpointId };
    await tx.update(nativeLiveTurnPreparations).set({
      ...(bound.started ? { parentProviderCheckpointId: bound.parentProviderCheckpointId } : {}),
      runtimeMetadata: { ...p.runtimeMetadata, native_live_input_binding: bound },
    }).where(eq(nativeLiveTurnPreparations.id, p.id));
    return { userMessageId: u.id, parentProviderCheckpointId: bound.parentProviderCheckpointId };
  }, { isolationLevel: "serializable" });
}
