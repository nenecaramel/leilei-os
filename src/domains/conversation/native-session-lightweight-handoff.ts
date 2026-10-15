import { sql } from "drizzle-orm";
import type { createDatabase } from "../../database/client.js";

type Database = ReturnType<typeof createDatabase>["db"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const revisionPattern = /^[0-9a-f]{64}$/;
const fail = (code: string) => Object.assign(new Error(code), { code });
type NativeRow = {
  id: string;
  current_head_message_id: string | null;
  provider_metadata: Record<string, unknown>;
  provider_session_id: string | null;
  provider_checkpoint_id: string | null;
  effective_working_directory: string | null;
  runtime_metadata: Record<string, unknown> | null;
};
type NativeSource = Record<string, unknown> & {
  sessionId?: string;
  owner?: "desktop" | "leileios";
  effectiveWorkingDirectory?: string;
};
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
function source(metadata: Record<string, unknown>): NativeSource {
  return asRecord(metadata.nativeSessionSource) as NativeSource;
}
async function readRow(db: Pick<Database, "execute">, input: { userId: string; conversationId: string }, locked = false) {
  const rows = await db.execute<NativeRow>(sql`
    SELECT c.id, c.current_head_message_id, c.provider_metadata,
      cp.provider_session_id, cp.provider_checkpoint_id,
      cp.effective_working_directory, cp.runtime_metadata
    FROM conversations c
    LEFT JOIN conversation_provider_session_checkpoints cp
      ON cp.conversation_id = c.id AND cp.user_id = c.user_id
      AND cp.canonical_message_id = c.current_head_message_id AND cp.provider = 'claude_code'
    WHERE c.id = ${input.conversationId}::uuid AND c.user_id = ${input.userId}::uuid
      AND c.origin = 'native_live' AND c.lifecycle_status = 'active'
    LIMIT 1
    ${locked ? sql`FOR UPDATE OF c` : sql``}
  `);
  return rows[0] ?? null;
}

export async function readNativeSessionLightState(db: Database, input: { userId: string; conversationId: string }) {
  if (![input.userId, input.conversationId].every(v => uuid.test(v))) throw fail("INVALID_NATIVE_PROJECTION");
  const row = await readRow(db, input);
  if (!row) throw fail("NATIVE_CONVERSATION_NOT_FOUND");
  const current = source(row.provider_metadata);
  return {
    conversationId: row.id, headMessageId: row.current_head_message_id,
    providerSessionId: row.provider_session_id,
    providerCheckpointId: row.provider_checkpoint_id,
    effectiveWorkingDirectory: row.effective_working_directory,
    owner: current.owner ?? "leileios",
    nativeRevision: typeof current.revision === "string" ? current.revision : null,
  };
}

/** Switch only writer ownership and the verified current native checkpoint.
 * Never upload/merge historical JSONL, image bytes, display blocks, or archives.
 * The Mac caller verifies a stable local source and inactive Desktop writer;
 * this transaction fences outstanding LeileiOS operations and stale state.
 */
export async function switchNativeSessionOwnerLight(db: Database, input: {
  userId: string;
  conversationId: string;
  sessionId: string;
  expectedHeadMessageId: string;
  expectedProviderCheckpointId: string;
  selectedCheckpointId: string;
  effectiveWorkingDirectory: string;
  nativeRevision: string;
  direction: "to_desktop" | "to_leileios";
}) {
  if (![input.userId, input.conversationId, input.sessionId, input.expectedHeadMessageId,
    input.expectedProviderCheckpointId, input.selectedCheckpointId].every(v => uuid.test(v))
    || !revisionPattern.test(input.nativeRevision)
    || typeof input.effectiveWorkingDirectory !== "string"
    || !input.effectiveWorkingDirectory.startsWith("/")
    || input.effectiveWorkingDirectory.length > 4096
    || !["to_desktop", "to_leileios"].includes(input.direction)) throw fail("INVALID_NATIVE_PROJECTION");

  return db.transaction(async tx => {
    const row = await readRow(tx, input, true);
    if (!row || row.current_head_message_id !== input.expectedHeadMessageId) throw fail("STALE_NATIVE_PROJECTION");
    if (row.provider_session_id !== input.sessionId
      || row.provider_checkpoint_id !== input.expectedProviderCheckpointId
      || row.effective_working_directory !== input.effectiveWorkingDirectory) throw fail("CANONICAL_CHECKPOINT_CHANGED");

    const previous = source(row.provider_metadata);
    const releasing = input.direction === "to_desktop";
    if ((previous.owner ?? "leileios") !== (releasing ? "leileios" : "desktop"))
      throw fail("NATIVE_SOURCE_BINDING_REQUIRED");
    if (previous.effectiveWorkingDirectory !== undefined
      && previous.effectiveWorkingDirectory !== input.effectiveWorkingDirectory)
      throw fail("EXPLICIT_BRANCH_SELECTION_REQUIRED");
    if (!releasing && previous.sessionId !== input.sessionId)
      throw fail("EXPLICIT_BRANCH_SELECTION_REQUIRED");
    if (releasing && input.selectedCheckpointId !== row.provider_checkpoint_id)
      throw fail("CANONICAL_CHECKPOINT_CHANGED");

    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('leileios-native-session:' || ${input.sessionId}, 0))`);
    const busy = await tx.execute(sql`
      SELECT 1 FROM native_live_turn_preparations
      WHERE user_id = ${input.userId}::uuid AND conversation_id = ${input.conversationId}::uuid
        AND dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')
      LIMIT 1
    `);
    const compact = await tx.execute(sql`
      SELECT 1 FROM native_live_manual_compactions
      WHERE user_id = ${input.userId}::uuid AND conversation_id = ${input.conversationId}::uuid
        AND status IN ('pending','reserved') LIMIT 1
    `);
    if (busy.length || compact.length) throw fail("NATIVE_CONVERSATION_BUSY");
    const other = await tx.execute(sql`
      SELECT 1 FROM conversations
      WHERE id <> ${input.conversationId}::uuid AND user_id = ${input.userId}::uuid
        AND origin = 'native_live' AND lifecycle_status = 'active'
        AND provider_metadata->'nativeSessionSource'->>'sessionId' = ${input.sessionId}
      LIMIT 1
    `);
    if (other.length) throw fail("NATIVE_SESSION_ALREADY_ATTACHED");

    const owner = releasing ? "desktop" : "leileios";
    const next = {
      ...previous, schemaVersion: 2, handoffMode: "native_checkpoint_only",
      sessionId: input.sessionId, checkpointId: input.selectedCheckpointId,
      revision: input.nativeRevision,
      effectiveWorkingDirectory: input.effectiveWorkingDirectory,
      headMessageId: input.expectedHeadMessageId, owner,
    };
    if (!releasing) {
      // Keep the original message checkpoint for Edit/Retry. Only an ordinary
      // Send should resume from the new Desktop tip (nativeResumeCheckpointSql).
      const presentation = asRecord(row.provider_metadata.native_live_presentation_owner);
      const tail = {
        canonical_message_id: input.expectedHeadMessageId,
        provider_session_id: input.sessionId,
        base_checkpoint_id: input.expectedProviderCheckpointId,
        checkpoint_id: input.selectedCheckpointId,
        cwd: input.effectiveWorkingDirectory,
        source_revision: input.nativeRevision,
        presentation_owner_id: presentation.prepareId ?? null,
      };
      await tx.execute(sql`
        UPDATE conversation_provider_session_checkpoints
        SET runtime_metadata = ${JSON.stringify({ ...row.runtime_metadata, native_live_resume_tail: tail })}::jsonb
        WHERE user_id = ${input.userId}::uuid AND conversation_id = ${input.conversationId}::uuid
          AND canonical_message_id = ${input.expectedHeadMessageId}::uuid AND provider = 'claude_code'
      `);
    }
    await tx.execute(sql`
      UPDATE conversations
      SET provider_metadata = ${JSON.stringify({ ...row.provider_metadata, nativeSessionSource: next })}::jsonb,
        updated_at = now()
      WHERE id = ${input.conversationId}::uuid AND user_id = ${input.userId}::uuid
    `);
    return {
      owner, conversationId: input.conversationId, providerSessionId: input.sessionId,
      providerCheckpointId: input.selectedCheckpointId, headMessageId: input.expectedHeadMessageId,
      nativeRevision: input.nativeRevision,
    };
  });
}
