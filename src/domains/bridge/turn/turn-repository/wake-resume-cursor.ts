import { sql } from "drizzle-orm";
import { nativeResumeCheckpointSql } from "../native-live-resume-checkpoint.js";
import type { PreparationRow, Transaction } from "./types.js";

// A native same-session Wake has already advanced Claude's local JSONL.
// Before discarding its visible result as stale, preserve that verified native
// cursor invisibly when the canonical assistant head has NOT moved. Otherwise
// the next send resumes from the old cursor and the CLI correctly refuses
// "unsynchronized history". Never hide a Wake behind a changed head or a
// started foreground: those are genuinely competing provider histories.
export async function commitWakeResumeCursorLocked(
  transaction: Transaction,
  row: PreparationRow,
  input: {
    providerSessionId: string;
    providerCheckpointId: string;
    effectiveWorkingDirectory: string | null;
  },
): Promise<"current" | "superseded" | "stale"> {
  if (row.operation !== "wake" || row.runtimeMode !== "resume"
    || !row.parentProviderCheckpointId || !row.parentProviderSessionId
    || input.providerSessionId !== row.parentProviderSessionId
    || input.effectiveWorkingDirectory !== row.expectedWorkingDirectory
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.providerCheckpointId))
    return "stale";

  const wake = row.wakeContext;
  const sourceHead = wake?.source_head_message_id;
  const sourceUser = wake?.source_user_message_id;
  const epoch = wake?.epoch_id;
  const generation = wake?.runtime_generation;
  const g = generation && typeof generation === "object" && !Array.isArray(generation)
    ? generation as Record<string, unknown> : null;
  if (typeof sourceHead !== "string" || typeof sourceUser !== "string"
    || epoch !== sourceUser || !g
    || !Object.hasOwn(g, "presentation_owner_id") || !Object.hasOwn(g, "source_revision")
    || !(g.presentation_owner_id === null || typeof g.presentation_owner_id === "string")
    || !(g.source_revision === null || typeof g.source_revision === "string"))
    return "stale";

  const [surface] = await transaction.execute<{
    head: string | null;
    owner: string | null;
    revision: string | null;
  }>(sql`
    SELECT c.current_head_message_id::text AS head,
      c.provider_metadata->'native_live_presentation_owner'->>'prepareId' AS owner,
      c.provider_metadata->'nativeSessionSource'->>'revision' AS revision
    FROM conversations c
    WHERE c.user_id = ${row.userId}::uuid AND c.id = ${row.conversationId}::uuid
      AND c.origin = 'native_live' AND c.lifecycle_status = 'active'
      AND coalesce(c.provider_metadata->'nativeSessionSource'->>'owner', 'leileios') = 'leileios'
    FOR UPDATE
  `);
  if (!surface || surface.head !== sourceHead) return "stale";
  const sourceRevision = g.source_revision as string | null;
  const sourceOwner = g.presentation_owner_id as string | null;
  // A different source revision is an import or ownership handoff, not an
  // in-session advance. Do not graft discarded native history onto it.
  if (surface.revision !== sourceRevision) return "stale";

  const [other] = await transaction.execute<{ active: boolean; replacing: boolean; pending: boolean }>(sql`
    SELECT
      EXISTS (SELECT 1 FROM native_live_turn_preparations p
        WHERE p.user_id = ${row.userId}::uuid AND p.conversation_id = ${row.conversationId}::uuid
          AND p.id <> ${row.id}::uuid AND p.operation <> 'wake'
          AND p.status = 'prepared'
          AND (p.execution_started_at IS NOT NULL OR p.dispatch_status IN ('executing','delivery_unknown'))) AS active,
      EXISTS (SELECT 1 FROM native_live_turn_preparations p
        WHERE p.user_id = ${row.userId}::uuid AND p.conversation_id = ${row.conversationId}::uuid
          AND p.id <> ${row.id}::uuid AND p.operation IN ('edit','retry')
          AND p.status = 'prepared'
          AND p.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')) AS replacing,
      EXISTS (SELECT 1 FROM native_live_turn_preparations p
        WHERE p.user_id = ${row.userId}::uuid AND p.id <> ${row.id}::uuid
          AND p.operation <> 'wake' AND p.status = 'prepared'
          AND p.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')) AS pending
  `);
  if (other?.active || other?.replacing) return "stale";

  let queuedSendId: string | null = null;
  if (surface.owner !== sourceOwner) {
    // Only a NEW not-yet-reserved send from this same original checkpoint
    // may take presentation ownership. The already-dispatched request identity
    // is immutable; such a race must fail closed, not retarget a live command.
    const [queued] = await transaction.execute<{ id: string }>(sql`
      SELECT p.id FROM native_live_turn_preparations p
      WHERE p.user_id = ${row.userId}::uuid AND p.conversation_id = ${row.conversationId}::uuid
        AND p.id::text = ${surface.owner}
        AND p.operation = 'send' AND p.runtime_mode = 'resume'
        AND p.status = 'prepared' AND p.dispatch_status IN ('staged','pending')
        AND p.execution_started_at IS NULL
        AND p.parent_provider_session_id = ${row.parentProviderSessionId}
        AND p.parent_provider_checkpoint_id = ${row.parentProviderCheckpointId}
        AND p.expected_working_directory IS NOT DISTINCT FROM ${row.expectedWorkingDirectory}::text
      LIMIT 1
      FOR UPDATE OF p
    `);
    if (!queued) return "stale";
    queuedSendId = queued.id;
  }

  const [binding] = await transaction.execute<{ id: string; base: string }>(sql`
    SELECT cp.id, cp.provider_checkpoint_id AS base
    FROM conversation_provider_session_checkpoints cp
    JOIN conversations c ON c.user_id = cp.user_id AND c.id = cp.conversation_id
    WHERE cp.user_id = ${row.userId}::uuid AND cp.conversation_id = ${row.conversationId}::uuid
      AND cp.canonical_message_id::text = ${sourceHead}
      AND cp.provider = 'claude_code'
      AND cp.provider_session_id = ${input.providerSessionId}
      AND cp.effective_working_directory IS NOT DISTINCT FROM ${input.effectiveWorkingDirectory}::text
      AND ${nativeResumeCheckpointSql("cp", "c", false)} = ${row.parentProviderCheckpointId}
    LIMIT 1
    FOR UPDATE OF cp
  `);
  if (!binding) return "stale";

  const cursor = {
    canonical_message_id: sourceHead,
    provider_session_id: input.providerSessionId,
    base_checkpoint_id: binding.base,
    checkpoint_id: input.providerCheckpointId,
    cwd: input.effectiveWorkingDirectory,
    presentation_owner_id: surface.owner,
    source_revision: surface.revision,
  };
  await transaction.execute(sql`
    UPDATE conversation_provider_session_checkpoints
    SET runtime_metadata = jsonb_set(coalesce(runtime_metadata, '{}'::jsonb),
      '{native_live_resume_tail}', ${JSON.stringify(cursor)}::jsonb)
    WHERE id = ${binding.id}::uuid AND user_id = ${row.userId}::uuid
  `);

  if (queuedSendId) {
    // The SDK may have advanced its JSONL while U was being staged.
    // Atomically retarget only a truly unstarted U to the verified Wake tail,
    // so even a daemon RESTART restores the correct producer checkpoint.
    // This also updates the immutable identity used by the eventual reserve.
    const retargeted = await transaction.execute<{ id: string }>(sql`
      UPDATE native_live_turn_preparations
      SET parent_provider_checkpoint_id = ${input.providerCheckpointId},
          updated_at = now()
      WHERE user_id = ${row.userId}::uuid AND id = ${queuedSendId}::uuid
        AND operation = 'send' AND runtime_mode = 'resume'
        AND parent_provider_checkpoint_id = ${row.parentProviderCheckpointId}
        AND status = 'prepared'
        AND dispatch_status IN ('staged', 'pending')
        AND execution_started_at IS NULL
      RETURNING id
    `);
    if (retargeted.length !== 1) throw new Error("Queued send changed during native Wake cursor reconciliation.");
  }

  const [latest] = await transaction.execute<{ id: string }>(sql`
    SELECT m.id FROM conversation_messages m JOIN conversations c
      ON c.id = m.conversation_id AND c.user_id = m.user_id
    WHERE m.user_id = ${row.userId}::uuid AND m.role = 'user'
      AND c.origin = 'native_live' AND c.lifecycle_status = 'active'
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  `);
  return surface.owner === sourceOwner && latest?.id === sourceUser && !other?.pending
    ? "current" : "superseded";
}
