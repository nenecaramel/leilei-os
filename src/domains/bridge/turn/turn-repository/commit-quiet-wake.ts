import { sql } from "drizzle-orm";
import { nativeResumeCheckpointSql } from "../native-live-resume-checkpoint.js";
import type { NativeLiveBackendTurnPort } from "../native-live-backend-turn-coordinator.js";
import type { Transaction, TurnRepositoryContext } from "./types.js";
import { discardWakeLocked } from "./discard-wake.js";

// Runs only after authenticated reservation ownership and protocol validation.
// Preserve the original canonical checkpoint; atomically commit an invisible
// resume cursor and consume the wake. No assistant message or Mind effect.
export async function commitQuietWake(this: TurnRepositoryContext,
  input: Parameters<NonNullable<NativeLiveBackendTurnPort["commitQuietWake"]>>[0],
): Promise<"committed" | "stale"> {
  return this.db.transaction(async transaction => {
    const row = await this.findById(transaction as Transaction, input.userId, input.preparation.prepareId, true);
    if (!row) return "stale";
    if (row.status !== "prepared" || row.operation !== "wake" || row.runtimeMode !== "resume") throw new Error("Quiet cursor requires a prepared same-session wake.");
    const wake = row.wakeContext;
    const sourceHead = wake?.source_head_message_id, sourceUser = wake?.source_user_message_id;
    const rawGeneration = wake?.runtime_generation;
    const generation = rawGeneration && typeof rawGeneration === "object" && !Array.isArray(rawGeneration) ? rawGeneration as Record<string, unknown> : null;
    const hasGeneration = generation && Object.hasOwn(generation, "presentation_owner_id") && Object.hasOwn(generation, "source_revision")
      && (generation.presentation_owner_id === null || typeof generation.presentation_owner_id === "string")
      && (generation.source_revision === null || typeof generation.source_revision === "string");
    const [surface] = await transaction.execute<{ id: string }>(sql`
      SELECT id FROM conversations WHERE user_id = ${input.userId}::uuid AND id = ${row.conversationId}::uuid FOR UPDATE
    `);
    const [binding] = surface ? await transaction.execute<{ id: string; base: string; owner: string | null; revision: string | null }>(sql`
      SELECT cp.id, cp.provider_checkpoint_id AS base,
        c.provider_metadata->'native_live_presentation_owner'->>'prepareId' AS owner,
        c.provider_metadata->'nativeSessionSource'->>'revision' AS revision
      FROM conversation_provider_session_checkpoints cp
      JOIN conversations c ON c.id = cp.conversation_id AND c.user_id = cp.user_id
      WHERE cp.user_id = ${input.userId}::uuid AND cp.conversation_id = ${row.conversationId}::uuid
        AND cp.provider = 'claude_code' AND cp.canonical_message_id::text = ${typeof sourceHead === "string" ? sourceHead : null}
        AND c.current_head_message_id = cp.canonical_message_id AND c.origin = 'native_live' AND c.lifecycle_status = 'active'
        AND ${!!hasGeneration}
        AND (c.provider_metadata->'native_live_presentation_owner'->>'prepareId') IS NOT DISTINCT FROM ${typeof generation?.presentation_owner_id === "string" ? generation.presentation_owner_id : null}::text
        AND (c.provider_metadata->'nativeSessionSource'->>'revision') IS NOT DISTINCT FROM ${typeof generation?.source_revision === "string" ? generation.source_revision : null}::text
        AND cp.provider_session_id = ${input.providerSessionId} AND cp.provider_session_id = ${row.parentProviderSessionId}
        AND cp.effective_working_directory IS NOT DISTINCT FROM ${input.effectiveWorkingDirectory}::text
        AND cp.effective_working_directory IS NOT DISTINCT FROM ${row.expectedWorkingDirectory}::text
        AND coalesce(c.provider_metadata->'nativeSessionSource'->>'owner', 'leileios') = 'leileios'
        AND ${nativeResumeCheckpointSql("cp", "c")} = ${row.parentProviderCheckpointId}
        AND ${typeof sourceUser === "string" ? sourceUser : null} = ${typeof wake?.epoch_id === "string" ? wake.epoch_id : null}
        AND ${typeof sourceUser === "string" ? sourceUser : null} = (
          SELECT m.id::text FROM conversation_messages m JOIN conversations active ON active.id = m.conversation_id AND active.user_id = m.user_id
          WHERE m.user_id = ${input.userId}::uuid AND m.role = 'user' AND active.origin = 'native_live' AND active.lifecycle_status = 'active'
          ORDER BY m.created_at DESC, m.id DESC LIMIT 1
        )
        AND NOT EXISTS (SELECT 1 FROM native_live_turn_preparations foreground WHERE foreground.user_id = ${input.userId}::uuid
          AND foreground.id <> ${row.id}::uuid AND foreground.operation <> 'wake' AND foreground.status = 'prepared'
          AND foreground.dispatch_status IN ('staged', 'pending', 'reserved', 'executing', 'delivery_unknown'))
      LIMIT 1
    `) : [];
    if (binding) {
      const tail = { canonical_message_id: sourceHead, provider_session_id: input.providerSessionId, base_checkpoint_id: binding.base,
        checkpoint_id: input.providerCheckpointId, cwd: input.effectiveWorkingDirectory, presentation_owner_id: binding.owner, source_revision: binding.revision };
      await transaction.execute(sql`UPDATE conversation_provider_session_checkpoints
        SET runtime_metadata = jsonb_set(coalesce(runtime_metadata, '{}'::jsonb), '{native_live_resume_tail}', ${JSON.stringify(tail)}::jsonb)
        WHERE id = ${binding.id}::uuid AND user_id = ${input.userId}::uuid`);
    }
    await discardWakeLocked(transaction as Transaction, row, input.providerSessionId);
    return binding ? "committed" : "stale";
  }, { isolationLevel: "serializable" });
}
