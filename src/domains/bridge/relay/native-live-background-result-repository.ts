import { appendBackgroundMessage, readDurableBackgroundReceipt } from "./native-live-background-message.js";
import { isDeepStrictEqual } from "node:util";
import { sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { nativeResumeCheckpointSql } from "../turn/native-live-resume-checkpoint.js";
import { readNativeWriterGeneration, syncNativeSessionOwner } from "../turn/turn-repository/session-owner.js";
import { hashJson } from "../turn/turn-repository/records.js";
import { canonicalizeNativeLiveEvents } from "../../conversation/native-live-conversation-orchestrator.js";
import { backgroundIdentity, backgroundResult, NativeLiveBackgroundResultError, type NativeLiveBackgroundIdentity, type NativeLiveBackgroundPrepare,
  type NativeLiveBackgroundSubmit, type NativeLiveBackgroundPrepared, type NativeLiveBackgroundAck } from "../protocol/native-live-background-result.js";
import { requireUuid } from "../protocol/runtime-protocol/parsing.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Database["transaction"]>[0] extends (tx: infer T) => unknown ? T : never;
type Source = { id: string; requestId: string; conversationId: string; sessionId: string | null; assistantId: string | null; listenerId: string | null; status: string; dispatch: string; operation: string };
type Snapshot = { id: string; canonicalMessageId: string; providerSessionId: string; baseCheckpointId: string; parentProviderCheckpointId: string; cwd: string | null; presentationOwnerId: string | null; sourceRevision: string | null };
export type NativeLiveBackgroundReceipt = Record<string, unknown> & { kind: "persistent_background_receipt_v1"; phase: "prepared" | NativeLiveBackgroundAck["outcome"];
  identity: NativeLiveBackgroundIdentity; prepareHash: string; resultHash: string | null; context: Snapshot; expiresAt: string; providerCheckpointId: string | null; executionStart?: boolean; deferred?: boolean; coveringCheckpointId?: string; nativeForegroundParentCheckpointId?: string; originalParentProviderCheckpointId?: string };
type Receipt = NativeLiveBackgroundReceipt;
const conflict = () => new NativeLiveBackgroundResultError("BACKGROUND_CONFLICT");

// Operational receipts fence transport. Visible replies own durable canonical
// messages/checkpoints; background delivery never invokes Mind finalization.
async function transaction<T>(db: Database, work: (tx: Transaction) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`); await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
      return work(tx as Transaction);
    }, { isolationLevel: "serializable" }); }
    catch (error) {
      const cause = error as { code?: string; cause?: { code?: string } }; const code = cause.code ?? cause.cause?.code;
      if (attempt === 0 && ["40001", "40P01", "23505"].includes(code ?? "")) continue;
      if (code === "23505") throw conflict();
      throw error;
    }
  }
}
async function source(tx: Transaction, userId: string, id: string): Promise<Source> {
  const [row] = await tx.execute<Source>(sql`SELECT id, request_id AS "requestId", conversation_id AS "conversationId", provider_session_id AS "sessionId",
    assistant_message_id AS "assistantId", reserved_by AS "listenerId", status, dispatch_status AS dispatch, operation
    FROM native_live_turn_preparations WHERE user_id=${userId}::uuid AND id=${id}::uuid FOR UPDATE`);
  if (!row) throw new NativeLiveBackgroundResultError("BACKGROUND_NOT_FOUND"); return row;
}
async function receipt(tx: Transaction, userId: string, identity: NativeLiveBackgroundIdentity): Promise<Receipt | null> {
  const [row] = await tx.execute<{ payload: Receipt | null }>(sql`SELECT payload FROM native_live_runtime_events
    WHERE id=${identity.receiptId}::uuid AND user_id=${userId}::uuid AND prepare_id=${identity.sourcePrepareId}::uuid AND event_type='runtime' FOR UPDATE`);
  if (!row?.payload) return null;
  if (row.payload.kind !== "persistent_background_receipt_v1" || !isDeepStrictEqual(row.payload.identity, identity)) throw conflict();
  return row.payload;
}

/**
 * Recover one historical Wake -> Cron receipt after a failed foreground send
 * replaced the presentation owner. This is deliberately receipt-bound: no new
 * background producer and no unrelated rejected command can reclaim a writer.
 * The conversation and live listener lease are locked by snapshot() first.
 */
async function reconcileRejectedWakePresentationOwner(
  tx: Transaction, userId: string, origin: Source, context: Snapshot,
): Promise<boolean> {
  if (origin.operation !== "wake" || origin.assistantId !== context.canonicalMessageId
    || !context.presentationOwnerId) return false;

  // The original foreground assistant need not be Wake's *immediate* source:
  // one or more earlier visible Wake / Cron assistants can advance the same
  // immutable SDK generation. Verify the actual canonical parent chain, with
  // a same-session, same-generation checkpoint for every intermediate node.
  // Do not accept matching timestamps, textual history or unrelated branches.
  const verifiedWakeSourceLineage = sql`
    EXISTS (
      SELECT 1 FROM conversation_messages wake_message
      WHERE wake_message.user_id=c.user_id AND wake_message.conversation_id=c.id
        AND wake_message.id=c.current_head_message_id
        AND wake_message.role='assistant' AND wake_message.status='completed'
        AND wake_message.parent_message_id::text=wake.wake_context->>'source_head_message_id'
    )
    AND (
      wake.wake_context->>'source_head_message_id'=owner.assistant_message_id::text
      OR EXISTS (
        WITH RECURSIVE assistants AS (
          SELECT m.id, m.parent_message_id, ARRAY[m.id] AS visited, 1 AS depth
          FROM conversation_messages m
          JOIN conversation_provider_session_checkpoints start_cp
            ON start_cp.user_id=m.user_id
            AND start_cp.conversation_id=m.conversation_id
            AND start_cp.canonical_message_id=m.id
          WHERE m.user_id=c.user_id AND m.conversation_id=c.id
            AND m.id::text=wake.wake_context->>'source_head_message_id'
            AND m.role='assistant' AND m.status='completed'
            AND start_cp.provider='claude_code'
            AND start_cp.provider_session_id=cp.provider_session_id
            AND start_cp.effective_working_directory IS NOT DISTINCT FROM cp.effective_working_directory
            AND start_cp.runtime_metadata->'native_live_generation'->>'presentation_owner_id'
              =${context.presentationOwnerId}
            AND start_cp.runtime_metadata->'native_live_generation'->>'source_revision'
              IS NOT DISTINCT FROM ${context.sourceRevision}::text
          UNION ALL
          SELECT parent.id, parent.parent_message_id,
            chain.visited||parent.id, chain.depth+1
          FROM assistants chain
          JOIN conversation_messages parent
            ON parent.id=chain.parent_message_id
            AND parent.user_id=c.user_id AND parent.conversation_id=c.id
          JOIN conversation_provider_session_checkpoints parent_cp
            ON parent_cp.user_id=parent.user_id
            AND parent_cp.conversation_id=parent.conversation_id
            AND parent_cp.canonical_message_id=parent.id
          WHERE chain.depth<128 AND NOT parent.id=ANY(chain.visited)
            AND parent.role='assistant' AND parent.status='completed'
            AND parent_cp.provider='claude_code'
            AND parent_cp.provider_session_id=cp.provider_session_id
            AND parent_cp.effective_working_directory IS NOT DISTINCT FROM cp.effective_working_directory
            AND parent_cp.runtime_metadata->'native_live_generation'->>'presentation_owner_id'
              =${context.presentationOwnerId}
            AND parent_cp.runtime_metadata->'native_live_generation'->>'source_revision'
              IS NOT DISTINCT FROM ${context.sourceRevision}::text
        )
        SELECT 1 FROM assistants WHERE id=owner.assistant_message_id
      )
    )
  `;

  const rows = await tx.execute<{ id: string }>(sql`
    UPDATE conversations c
    SET provider_metadata=jsonb_set(
      jsonb_set(c.provider_metadata,
        '{native_live_presentation_owner,prepareId}',to_jsonb(${context.presentationOwnerId}::text)),
      '{native_live_presentation_owner,anchorHeadMessageId}',to_jsonb(${context.canonicalMessageId}::text))
    FROM native_live_turn_preparations rejected
    JOIN conversation_messages rejected_user
      ON rejected_user.id=rejected.canonical_user_message_id
      AND rejected_user.user_id=rejected.user_id
      AND rejected_user.conversation_id=rejected.conversation_id
    JOIN conversation_provider_session_checkpoints cp
      ON cp.user_id=rejected.user_id AND cp.conversation_id=rejected.conversation_id
    JOIN native_live_turn_preparations wake
      ON wake.user_id=rejected.user_id AND wake.conversation_id=rejected.conversation_id
      AND wake.id=${origin.id}::uuid
    JOIN native_live_turn_preparations owner
      ON owner.user_id=rejected.user_id AND owner.conversation_id=rejected.conversation_id
      AND owner.id=${context.presentationOwnerId}::uuid
    WHERE c.id=${origin.conversationId}::uuid AND c.user_id=${userId}::uuid
      AND c.id=rejected.conversation_id
      AND c.origin='native_live' AND c.lifecycle_status='active'
      AND coalesce(c.provider_metadata->'nativeSessionSource'->>'owner','leileios')='leileios'
      AND c.provider_metadata->'nativeSessionSource'->>'revision'
        IS NOT DISTINCT FROM ${context.sourceRevision}::text
      AND c.current_head_message_id=${context.canonicalMessageId}::uuid
      AND (c.provider_metadata->'native_live_presentation_owner'->>'prepareId')=rejected.id::text
      AND (c.provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId')
        =c.current_head_message_id::text
      AND cp.id=${context.id}::uuid AND cp.canonical_message_id=c.current_head_message_id
      AND cp.provider='claude_code'
      AND cp.provider_session_id=${context.providerSessionId}
      AND cp.provider_checkpoint_id=${context.baseCheckpointId}
      AND cp.effective_working_directory IS NOT DISTINCT FROM ${context.cwd}
      AND cp.runtime_metadata->'native_live_generation'->>'presentation_owner_id'
        =${context.presentationOwnerId}
      AND cp.runtime_metadata->'native_live_generation'->>'source_revision'
        IS NOT DISTINCT FROM ${context.sourceRevision}::text
      AND wake.operation='wake' AND wake.status='finalized_success'
      AND wake.dispatch_status='completed'
      AND wake.assistant_message_id=c.current_head_message_id
      AND wake.provider_session_id=cp.provider_session_id
      AND wake.wake_context->'runtime_generation'->>'presentation_owner_id'
        =${context.presentationOwnerId}
      AND wake.wake_context->'runtime_generation'->>'source_revision'
        IS NOT DISTINCT FROM ${context.sourceRevision}::text
      AND ${verifiedWakeSourceLineage}
      AND owner.status='finalized_success' AND owner.dispatch_status='completed'
      AND owner.provider_session_id=cp.provider_session_id
      AND rejected.operation='send' AND rejected.runtime_mode='resume'
      AND rejected.status='prepared' AND rejected.dispatch_status='rejected'
      AND rejected.dispatch_error_code='INVALID_COMMAND'
      AND rejected.result_hash IS NULL AND rejected.assistant_message_id IS NULL
      -- INVALID_COMMAND alone is not proof that the model never ran.
      -- A rejected turn with any durable runtime evidence cannot be reclaimed.
      AND NOT EXISTS (
        SELECT 1 FROM native_live_runtime_events rejected_event
        WHERE rejected_event.user_id=c.user_id
          AND rejected_event.prepare_id=rejected.id
      )
      AND rejected.runtime_metadata->'native_live_input_binding'->>'started' IS DISTINCT FROM 'true'
      AND rejected.created_at >= wake.finalized_at
      AND rejected.parent_provider_session_id=cp.provider_session_id
      AND rejected.parent_provider_checkpoint_id=cp.provider_checkpoint_id
      AND rejected.expected_working_directory IS NOT DISTINCT FROM cp.effective_working_directory
      AND rejected_user.parent_message_id=c.current_head_message_id
      AND NOT EXISTS (
        SELECT 1 FROM native_live_turn_preparations active
        WHERE active.user_id=c.user_id AND active.conversation_id=c.id
          AND active.status='prepared' AND active.operation<>'wake'
          AND active.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')
      )
    RETURNING c.id
  `);
  if (rows.length === 1) await syncNativeSessionOwner(tx, { userId, conversationId: origin.conversationId });

  return rows.length === 1;
}

async function snapshot(tx: Transaction, userId: string, identity: NativeLiveBackgroundIdentity, origin: Source, executionStart = false, deferred = false, knownReceipt: Snapshot | null = null): Promise<Snapshot | null> {
  if (origin.status !== "finalized_success" || origin.dispatch !== "completed" || origin.listenerId !== identity.listenerInstanceId || !origin.assistantId) return null;
  await tx.execute(sql`SELECT id FROM conversations WHERE user_id=${userId}::uuid AND id=${origin.conversationId}::uuid FOR UPDATE`);
  // Lease takeover cannot commit between this check and the cursor transaction.
  const [lease] = await tx.execute(sql`SELECT user_id FROM native_live_runtime_listener_leases WHERE user_id=${userId}::uuid
    AND dispatch_target='claude_code' AND listener_instance_id=${identity.listenerInstanceId}::uuid AND lease_expires_at>clock_timestamp() FOR SHARE`);
  if (!lease) return null;
  const repaired = knownReceipt && !executionStart && !deferred
    ? await reconcileRejectedWakePresentationOwner(tx, userId, origin, knownReceipt)
    : false;
  const pendingOwner = sql`EXISTS (SELECT 1 FROM native_live_turn_preparations pending
    JOIN conversation_messages u ON u.id=pending.canonical_user_message_id AND u.user_id=pending.user_id AND u.conversation_id=pending.conversation_id
    WHERE pending.user_id=c.user_id AND pending.conversation_id=c.id AND pending.id::text=c.provider_metadata->'native_live_presentation_owner'->>'prepareId'
      AND pending.operation='send' AND pending.runtime_mode='resume' AND pending.status='prepared'
      AND pending.dispatch_status IN ('staged','pending','reserved','executing')
      AND ((${executionStart} AND coalesce(pending.runtime_metadata->'native_live_input_binding'->>'started','false')='false')
        OR (${deferred} AND pending.runtime_metadata->'native_live_input_binding'->>'started'='true'))
      AND pending.parent_provider_session_id=cp.provider_session_id
      AND pending.expected_working_directory IS NOT DISTINCT FROM cp.effective_working_directory
      AND u.parent_message_id=cp.canonical_message_id
      AND (c.provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId')=cp.canonical_message_id::text)`;
  const gen = sql`cp.runtime_metadata->'native_live_generation'`;
  // Foreground reservation changes the presentation owner before the native
  // input starts. A quiet tail from the same source session still counts, but
  // only with the explicit pending-owner and source-revision fences below.
  const resume = nativeResumeCheckpointSql("cp", "c", !(executionStart || deferred));
  const [row] = await tx.execute<Snapshot>(sql`SELECT cp.id, cp.canonical_message_id::text AS "canonicalMessageId", cp.provider_session_id AS "providerSessionId",
    cp.provider_checkpoint_id AS "baseCheckpointId", ${resume} AS "parentProviderCheckpointId", cp.effective_working_directory AS cwd,
    c.provider_metadata->'native_live_presentation_owner'->>'prepareId' AS "presentationOwnerId", c.provider_metadata->'nativeSessionSource'->>'revision' AS "sourceRevision"
    FROM conversation_provider_session_checkpoints cp JOIN conversations c ON c.id=cp.conversation_id AND c.user_id=cp.user_id
    WHERE cp.user_id=${userId}::uuid AND cp.conversation_id=${origin.conversationId}::uuid AND (cp.canonical_message_id=${origin.assistantId}::uuid
        OR cp.runtime_metadata->'native_live_background_receipt'->'identity'->>'sourcePrepareId'=${origin.id})
      AND cp.provider='claude_code' AND cp.provider_session_id=${origin.sessionId} AND cp.provider_checkpoint_id IS NOT NULL
      AND c.current_head_message_id=cp.canonical_message_id AND c.origin='native_live' AND c.lifecycle_status='active'
      AND coalesce(c.provider_metadata->'nativeSessionSource'->>'owner','leileios')='leileios'
      AND jsonb_typeof(${gen})='object' AND ${gen} ? 'presentation_owner_id' AND ${gen} ? 'source_revision'
      AND ((${gen}->>'presentation_owner_id') IS NOT DISTINCT FROM (c.provider_metadata->'native_live_presentation_owner'->>'prepareId') OR ((${executionStart} OR ${deferred}) AND ${pendingOwner}))
      AND (${gen}->>'source_revision') IS NOT DISTINCT FROM (c.provider_metadata->'nativeSessionSource'->>'revision')
      AND NOT EXISTS (SELECT 1 FROM native_live_turn_preparations busy WHERE busy.user_id=${userId}::uuid AND busy.conversation_id=c.id
        AND busy.status='prepared' AND busy.operation<>'wake' AND busy.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')
        AND (NOT (${executionStart} OR ${deferred}) OR busy.operation<>'send' OR busy.runtime_mode<>'resume' OR busy.dispatch_status='delivery_unknown'
          OR busy.id::text IS DISTINCT FROM (c.provider_metadata->'native_live_presentation_owner'->>'prepareId')
          OR busy.parent_provider_session_id IS DISTINCT FROM cp.provider_session_id
          OR NOT ((${executionStart} AND coalesce(busy.runtime_metadata->'native_live_input_binding'->>'started','false')='false')
            OR (${deferred} AND busy.runtime_metadata->'native_live_input_binding'->>'started'='true'))))
    LIMIT 1 FOR UPDATE OF cp`);
  if (repaired && (!row || !isDeepStrictEqual(row, knownReceipt))) throw conflict();
  return row ?? null;
}
/** A covering F checkpoint must already be canonical and descendant of
 * the original source assistant. The intermediate foreground F must have a
 * native-start binding; any new pending send blocks delayed publication.
 * This is still server-side ancestry, not an independent proof of the CLI
 * producer checkpoint: Mac verifies B -> F before journaling the cover. */
async function coveringSnapshot(tx: Transaction, userId: string, origin: Source,
  identity: NativeLiveBackgroundIdentity, preparedContext: Snapshot,
  coveringCheckpointId: string, nativeForegroundParentCheckpointId: string): Promise<Snapshot | null> {
  // Serialize head selection with normal foreground commits, rewind/handoff,
  // and concurrent background publishers. Never query a moving head then
  // append under an unrelated later branch.
  await tx.execute(sql`SELECT id FROM conversations WHERE id=${origin.conversationId}::uuid
    AND user_id=${userId}::uuid FOR UPDATE`);
  const [lease] = await tx.execute(sql`SELECT 1 FROM native_live_runtime_listener_leases WHERE user_id=${userId}::uuid
    AND dispatch_target='claude_code' AND listener_instance_id=${origin.listenerId}::uuid
      AND lease_expires_at>clock_timestamp() FOR SHARE`);
  if (!lease) return null;
  const [row] = await tx.execute<Snapshot>(sql`
    WITH RECURSIVE chain AS (
      SELECT m.id,m.parent_message_id,0 AS depth,ARRAY[m.id] AS visited
      FROM conversation_messages m JOIN conversations c ON c.current_head_message_id=m.id
      WHERE c.id=${origin.conversationId}::uuid AND c.user_id=${userId}::uuid
        AND m.user_id=c.user_id AND m.conversation_id=c.id
      UNION ALL
      SELECT m.id,m.parent_message_id,chain.depth+1,chain.visited||m.id
      FROM chain JOIN conversation_messages m ON m.id=chain.parent_message_id
      WHERE m.user_id=${userId}::uuid AND m.conversation_id=${origin.conversationId}::uuid
        AND chain.depth<4095 AND NOT m.id=ANY(chain.visited)
    )
    SELECT cp.id,cp.canonical_message_id::text AS "canonicalMessageId",
      cp.provider_session_id AS "providerSessionId",cp.provider_checkpoint_id AS "baseCheckpointId",
      cp.provider_checkpoint_id AS "parentProviderCheckpointId",cp.effective_working_directory AS cwd,
      c.provider_metadata->'native_live_presentation_owner'->>'prepareId' AS "presentationOwnerId",
      c.provider_metadata->'nativeSessionSource'->>'revision' AS "sourceRevision"
    FROM conversations c JOIN conversation_provider_session_checkpoints cp
      ON cp.user_id=c.user_id AND cp.conversation_id=c.id
      AND cp.canonical_message_id=c.current_head_message_id
    WHERE c.id=${origin.conversationId}::uuid AND c.user_id=${userId}::uuid
      AND c.origin='native_live' AND c.lifecycle_status='active'
      AND coalesce(c.provider_metadata->'nativeSessionSource'->>'owner','leileios')='leileios'
      AND cp.provider='claude_code' AND cp.provider_session_id=${preparedContext.providerSessionId}
      AND cp.provider_checkpoint_id=${coveringCheckpointId}
      AND cp.effective_working_directory IS NOT DISTINCT FROM ${preparedContext.cwd}
      AND (c.provider_metadata->'nativeSessionSource'->>'revision') IS NOT DISTINCT FROM ${preparedContext.sourceRevision}
      AND EXISTS (SELECT 1 FROM chain WHERE id=${origin.assistantId}::uuid)
      AND EXISTS (
        SELECT 1 FROM chain witness
        JOIN native_live_turn_preparations foreground
          ON foreground.user_id=${userId}::uuid AND foreground.conversation_id=c.id
          AND foreground.assistant_message_id=witness.id AND foreground.operation='send'
          AND foreground.status='finalized_success'
        JOIN conversation_provider_session_checkpoints fc
          ON fc.user_id=foreground.user_id AND fc.conversation_id=c.id
          AND fc.canonical_message_id=witness.id AND fc.provider='claude_code'
        WHERE foreground.runtime_metadata->'native_live_input_binding'->>'started'='true'
          AND foreground.parent_provider_session_id=${preparedContext.providerSessionId}
          AND (
            foreground.parent_provider_checkpoint_id=${nativeForegroundParentCheckpointId}
            OR EXISTS (
              -- F began natively after B1/B2 were queued. Its parent cursor
              -- is the last producer B, while accepted user U still belongs
              -- canonically to H. Require that producer's own prior
              -- authenticated, same-owner native receipt (never a guess).
              SELECT 1 FROM native_live_runtime_events producer
              WHERE producer.user_id=${userId}::uuid
                AND producer.prepare_id=${origin.id}::uuid
                AND producer.event_type='runtime'
                AND producer.payload->>'kind'='persistent_background_receipt_v1'
                AND producer.payload->>'phase' IN ('queued','committed')
                AND producer.payload->>'executionStart'='true'
                AND producer.payload->>'deferred'='true'
                AND producer.payload->'identity'->>'listenerInstanceId'=${identity.listenerInstanceId}
                AND producer.payload->'identity'->>'generationId'=${identity.generationId}
                AND producer.payload->'context'->>'providerSessionId'=${preparedContext.providerSessionId}
                AND producer.payload->'context'->>'canonicalMessageId'=${origin.assistantId}
                AND producer.payload->'context'->>'presentationOwnerId'=foreground.id::text
                AND producer.payload->'context'->>'sourceRevision' IS NOT DISTINCT FROM ${preparedContext.sourceRevision}
                AND producer.payload->'result'->>'provider_checkpoint_id'=foreground.parent_provider_checkpoint_id
            )
          )
          AND fc.provider_session_id=${preparedContext.providerSessionId}
          AND fc.provider_checkpoint_id=${coveringCheckpointId}
      )
      AND NOT EXISTS (
        SELECT 1 FROM native_live_turn_preparations active
        WHERE active.user_id=c.user_id AND active.conversation_id=c.id
          AND active.status='prepared' AND active.operation<>'wake'
          AND active.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')
      )
    LIMIT 1 FOR UPDATE OF cp
  `);
  return row ?? null;
}

// Before the visible-Wake anchor fix, Wake could commit H -> W while
// leaving the original presentation owner anchored to H. The next Cron B
// would pass prepare, then fail the canonical append with BACKGROUND_CONFLICT.
// Repair only that exact historical Wake transition, while snapshot() has
// already locked/verified the current head, session, generation, and absence
// of a competing foreground. Never rewrite an arbitrary mismatched anchor.
async function reconcileLegacyVisibleWakeAnchor(
  tx: Transaction, userId: string, origin: Source, context: Snapshot,
): Promise<void> {
  if (origin.operation !== "wake" || origin.assistantId !== context.canonicalMessageId) return;
  await tx.execute(sql`
    UPDATE conversations c
    SET provider_metadata = jsonb_set(
      c.provider_metadata, '{native_live_presentation_owner,anchorHeadMessageId}',
      to_jsonb(${context.canonicalMessageId}::text)
    )
    FROM native_live_turn_preparations wake
    WHERE c.user_id=${userId}::uuid AND c.id=${origin.conversationId}::uuid
      AND c.current_head_message_id=${context.canonicalMessageId}::uuid
      AND wake.user_id=c.user_id AND wake.conversation_id=c.id AND wake.id=${origin.id}::uuid
      AND wake.operation='wake' AND wake.status='finalized_success'
      AND wake.dispatch_status='completed'
      AND wake.assistant_message_id=c.current_head_message_id
      AND (c.provider_metadata->'native_live_presentation_owner'->>'prepareId')
        IS NOT DISTINCT FROM ${context.presentationOwnerId}::text
      AND (c.provider_metadata->'nativeSessionSource'->>'revision')
        IS NOT DISTINCT FROM ${context.sourceRevision}::text
      AND (c.provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId')
        = wake.wake_context->>'source_head_message_id'
      AND wake.wake_context->'runtime_generation'->>'presentation_owner_id'
        IS NOT DISTINCT FROM ${context.presentationOwnerId}::text
      AND wake.wake_context->'runtime_generation'->>'source_revision'
        IS NOT DISTINCT FROM ${context.sourceRevision}::text
  `);
  await syncNativeSessionOwner(tx, { userId, conversationId: origin.conversationId });
}
function prepared(identity: NativeLiveBackgroundIdentity, value: Receipt): NativeLiveBackgroundPrepared {
  return { receiptId: identity.receiptId, providerSessionId: value.context.providerSessionId, parentProviderCheckpointId: value.originalParentProviderCheckpointId ?? value.context.parentProviderCheckpointId, expiresAt: value.expiresAt };
}

export async function prepareNativeLiveBackgroundResult(db: Database, input: NativeLiveBackgroundPrepare & { userId: string }): Promise<NativeLiveBackgroundPrepared> {
  const identity = backgroundIdentity(input), userId = requireUuid(input.userId, "userId"), parent = requireUuid(input.parentProviderCheckpointId, "parentProviderCheckpointId");
  const prepareHash = hashJson("background-prepare-v1", { ...identity, parentProviderCheckpointId: parent, ...(input.executionStart ? { executionStart: true } : {}), ...(input.deferred ? { deferred: true } : {}) });
  return transaction(db, async tx => {
    const durable = await readDurableBackgroundReceipt(tx, userId, identity);
    if (durable) {
      if (!isDeepStrictEqual(durable.identity, identity) || durable.prepareHash !== prepareHash) throw conflict();
      return prepared(identity, durable);
    }
    const origin = await source(tx, userId, identity.sourcePrepareId);
    const existing = await receipt(tx, userId, identity);
    if (existing) {
      if (existing.prepareHash !== prepareHash) throw conflict();
      if (existing.phase !== "prepared" || new Date(existing.expiresAt).getTime() > Date.now())
        return prepared(identity, existing);
      // HTTP preparation may have succeeded before a prolonged network outage.
      // Its local outbox receipt must be retryable without re-running Claude,
      // but an expired lease alone cannot authorize it. Re-check the exact
      // live source/head/generation/foreground ownership under the same locks
      // before extending only its transport deadline; never reset committed
      // or queued outcomes or switch the producer checkpoint.
      const live = await snapshot(tx, userId, identity, origin,
        existing.executionStart === true, existing.deferred === true, existing.context);
      if (!live || !isDeepStrictEqual(live, existing.context)) throw conflict();
      const renewed: Receipt = {
        ...existing, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
      const updated = await tx.execute(sql`
        UPDATE native_live_runtime_events SET payload=${JSON.stringify(renewed)}::jsonb
        WHERE id=${identity.receiptId}::uuid AND user_id=${userId}::uuid
          AND prepare_id=${identity.sourcePrepareId}::uuid
          AND payload->>'phase'='prepared' RETURNING id
      `);
      if (updated.length !== 1) throw conflict();
      return prepared(identity, renewed);
    }
    const root = await snapshot(tx, userId, identity, origin, input.executionStart, input.deferred);
    if (!root) throw conflict();
    let context = root;
    // Several autonomous SDK segments can complete inside one foreground F.
    // B2's parent is the queued producer B1, not the still-current canonical
    // checkpoint. The earlier receipt's exact identity/session/generation
    // proves the native producer chain without prematurely publishing B1.
    if (input.deferred && root.parentProviderCheckpointId !== parent) {
      const [prior] = await tx.execute<{ receipt: Receipt }>(sql`
        SELECT e.payload AS receipt FROM native_live_runtime_events e
        WHERE e.user_id=${userId}::uuid AND e.prepare_id=${identity.sourcePrepareId}::uuid
          AND e.event_type='runtime'
          AND e.payload->>'kind'='persistent_background_receipt_v1'
          AND e.payload->>'phase'='queued'
          AND e.payload->'result'->>'provider_checkpoint_id'=${parent}
          AND e.payload->'identity'->>'listenerInstanceId'=${identity.listenerInstanceId}
          AND e.payload->'identity'->>'generationId'=${identity.generationId}
          AND e.payload->'context'->>'providerSessionId'=${root.providerSessionId}
          AND e.payload->'context'->>'sourceRevision' IS NOT DISTINCT FROM ${root.sourceRevision}
        ORDER BY e.sequence DESC LIMIT 1
      `);
      if (!prior?.receipt) throw conflict();
      context = { ...root, parentProviderCheckpointId: parent };
    }
    if (context.parentProviderCheckpointId !== parent) throw conflict();
    if (input.executionStart) {
      const [busy] = await tx.execute(sql`SELECT 1 FROM native_live_runtime_events e JOIN native_live_turn_preparations p ON p.id=e.prepare_id AND p.user_id=e.user_id
        WHERE e.user_id=${userId}::uuid AND p.conversation_id=${origin.conversationId}::uuid
          AND e.payload->>'kind'='persistent_background_receipt_v1' AND e.payload->>'phase'='prepared'
          AND e.payload->>'executionStart'='true' AND (e.payload->>'expiresAt')::timestamptz>clock_timestamp() LIMIT 1`);
      if (busy) throw conflict();
    }
    const value: Receipt = { ...(input.executionStart ? { executionStart: true } : {}), ...(input.deferred ? { deferred: true, nativeForegroundParentCheckpointId: root.parentProviderCheckpointId } : {}), kind: "persistent_background_receipt_v1", phase: "prepared", identity, prepareHash, resultHash: null,
      originalParentProviderCheckpointId: parent, context,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), providerCheckpointId: null };
    await tx.execute(sql`INSERT INTO native_live_runtime_events(id,user_id,prepare_id,sequence,event_type,provider_session_id,payload)
      SELECT ${identity.receiptId}::uuid,${userId}::uuid,${identity.sourcePrepareId}::uuid,coalesce(max(sequence),0)+1,'runtime',${context.providerSessionId},${JSON.stringify(value)}::jsonb
      FROM native_live_runtime_events WHERE user_id=${userId}::uuid AND prepare_id=${identity.sourcePrepareId}::uuid`);
    return prepared(identity, value);
  });
}

export async function submitNativeLiveBackgroundResult(db: Database, input: NativeLiveBackgroundSubmit & { userId: string }): Promise<NativeLiveBackgroundAck> {
  const identity = backgroundIdentity(input), userId = requireUuid(input.userId, "userId"), result = backgroundResult(input.result);
  const resultHash = hashJson("background-result-v1", result);
  return transaction(db, async tx => {
    const durable = await readDurableBackgroundReceipt(tx, userId, identity);
    if (durable) {
      if (!isDeepStrictEqual(durable.identity, identity) || durable.resultHash !== resultHash) throw conflict();
      return { outcome: "committed", duplicate: true, providerCheckpointId: durable.providerCheckpointId };
    }
    const origin = await source(tx, userId, identity.sourcePrepareId), stored = await receipt(tx, userId, identity);
    if (!stored) throw new NativeLiveBackgroundResultError("BACKGROUND_NOT_FOUND");
    if (result.prepare_id !== origin.id || result.request_id !== origin.requestId || result.conversation_id !== origin.conversationId) throw conflict();
    // A queued F-cover retry must not gain authority from a new listener or
    // source writer that happens to reuse the same conversation. The old
    // authenticated origin was fixed at the original prepare transaction.
    if (origin.listenerId !== identity.listenerInstanceId || origin.sessionId !== stored.context.providerSessionId
      || origin.status !== "finalized_success" || origin.dispatch !== "completed" || !origin.assistantId)
      throw conflict();
    if (stored.deferred === true && (stored.phase === "prepared" || stored.phase === "queued")) {
      if (stored.phase === "queued" && stored.resultHash !== resultHash) throw conflict();
      if (result.status === "success" && (
        result.provider_session_id !== stored.context.providerSessionId
        || result.effective_working_directory !== stored.context.cwd
        || result.provider_checkpoint_id === stored.context.parentProviderCheckpointId
      )) throw conflict();
      let queued = stored;
      let duplicate = stored.phase === "queued";
      if (!duplicate) {
        if (new Date(stored.expiresAt).getTime() <= Date.now()) throw conflict();
        queued = {
          ...stored, phase: result.status === "success" ? "queued" : "failed",
          resultHash, providerCheckpointId: null,
        };
        const queuedRow = await tx.execute(sql`
          UPDATE native_live_runtime_events
          SET payload=${JSON.stringify({ ...queued, result })}::jsonb
          WHERE id=${identity.receiptId}::uuid AND user_id=${userId}::uuid
            AND prepare_id=${identity.sourcePrepareId}::uuid
            AND payload->>'phase'='prepared' RETURNING id
        `);
        if (queuedRow.length !== 1) throw conflict();
      }
      if (queued.phase === "failed") return { outcome: "failed", duplicate, providerCheckpointId: null };
      // Queued means transport custody only; the canonical conversation head
      // and its checkpoint are unchanged until F is committed and covered.
      if (!input.coveringCheckpointId) return { outcome: "queued", duplicate, providerCheckpointId: null };
      // Native B2 is a descendant of producer B1, not of foreground F.
      // A covering F checkpoint cannot justify publishing B2 before B1:
      // doing so would reverse the canonical messages despite identical
      // continuation checkpoints. Outbox FIFO is the first barrier; keep a
      // second server-side barrier for retries, HTTP reordering and restarts.
      const producerParent = stored.originalParentProviderCheckpointId
        ?? stored.context.parentProviderCheckpointId;
      const nativeRoot = stored.nativeForegroundParentCheckpointId;
      if (nativeRoot && producerParent !== nativeRoot) {
        const [predecessor] = await tx.execute(sql`
          SELECT e.id FROM native_live_runtime_events e
          WHERE e.user_id=${userId}::uuid AND e.prepare_id=${identity.sourcePrepareId}::uuid
            AND e.id IS DISTINCT FROM ${identity.receiptId}::uuid
            AND e.event_type='runtime'
            AND e.payload->>'kind'='persistent_background_receipt_v1'
            AND e.payload->>'phase'='committed'
            AND e.payload->'identity'->>'listenerInstanceId'=${identity.listenerInstanceId}
            AND e.payload->'identity'->>'generationId'=${identity.generationId}
            AND e.payload->'context'->>'providerSessionId'=${stored.context.providerSessionId}
            AND e.payload->'result'->>'provider_checkpoint_id'=${producerParent}
          LIMIT 1
        `);
        if (!predecessor)
          return { outcome: "queued", duplicate: true, providerCheckpointId: null };
      }
      const covering = await coveringSnapshot(tx, userId, origin, identity, stored.context,
        requireUuid(input.coveringCheckpointId, "coveringCheckpointId"),
        stored.nativeForegroundParentCheckpointId ?? stored.context.parentProviderCheckpointId);
      if (!covering) return { outcome: "queued", duplicate: true, providerCheckpointId: null };
      if (result.status !== "success") throw conflict();
      // A native segment can be a quiet internal continuation with no chat
      // content. F's verified covering checkpoint already includes it. Commit
      // its operational receipt idempotently WITHOUT creating an empty bubble
      // or moving the canonical head. Actual replies still require a durable
      // message, blocks, checkpoint and head in this same transaction.
      const canonical = canonicalizeNativeLiveEvents(result.normalized_events);
      if (canonical.error) throw new NativeLiveBackgroundResultError("INVALID_BACKGROUND_RESULT");
      const terminal: Receipt = {
        ...queued, phase: "committed", context: covering,
        coveringCheckpointId: input.coveringCheckpointId,
        providerCheckpointId: input.coveringCheckpointId,
      };
      if (canonical.blocks.length > 0 || result.output_attachment_ids?.length) {
        const visible = await appendBackgroundMessage(tx, {
          userId, conversationId: origin.conversationId, receipt: terminal, result,
        });
        if (!visible) throw new NativeLiveBackgroundResultError("INVALID_BACKGROUND_RESULT");
      }
      const written = await tx.execute(sql`
        UPDATE native_live_runtime_events
        SET payload=${JSON.stringify({ ...terminal, result })}::jsonb
        WHERE id=${identity.receiptId}::uuid AND user_id=${userId}::uuid
          AND prepare_id=${identity.sourcePrepareId}::uuid
          AND payload->>'phase'='queued' RETURNING id
      `);
      if (written.length !== 1) throw conflict();
      return { outcome: "committed", duplicate: false, providerCheckpointId: input.coveringCheckpointId };
    }
    if (stored.phase !== "prepared") {
      if (stored.resultHash !== resultHash) throw conflict();
      return { outcome: stored.phase, duplicate: true, providerCheckpointId: stored.providerCheckpointId };
    }
    if (result.status === "success" && (result.provider_session_id !== stored.context.providerSessionId || result.effective_working_directory !== stored.context.cwd
      || result.provider_checkpoint_id === stored.context.parentProviderCheckpointId)) throw conflict();
    const current = await snapshot(tx, userId, identity, origin, stored.executionStart, false,
      new Date(stored.expiresAt).getTime() > Date.now() ? stored.context : null);
    const live = current && new Date(stored.expiresAt).getTime() > Date.now()
      && (isDeepStrictEqual(current, stored.context) || (stored.executionStart === true
        && isDeepStrictEqual({ ...current, presentationOwnerId: stored.context.presentationOwnerId }, stored.context)));
    const outcome = !live ? "stale" : result.status === "success" ? "committed" : "failed";
    const checkpoint = outcome === "committed" && result.status === "success" ? result.provider_checkpoint_id! : null;
    const terminal: Receipt = { ...stored, ...(live && current ? { context: current } : {}), phase: outcome, resultHash, providerCheckpointId: checkpoint };
    if (checkpoint && result.status === "success")
      await reconcileLegacyVisibleWakeAnchor(tx, userId, origin, stored.context);
    const visible = checkpoint && result.status === "success"
      ? await appendBackgroundMessage(tx, { userId, conversationId: origin.conversationId, receipt: terminal, result }) : false;
    if (checkpoint && !visible) {
      const c = stored.context;
      const tail = { canonical_message_id: c.canonicalMessageId, provider_session_id: c.providerSessionId, base_checkpoint_id: c.baseCheckpointId,
        checkpoint_id: checkpoint, cwd: c.cwd, presentation_owner_id: c.presentationOwnerId, source_revision: c.sourceRevision,
        writer_generation: await readNativeWriterGeneration(tx, { userId, conversationId: origin.conversationId }) };
      const rows = await tx.execute(sql`UPDATE conversation_provider_session_checkpoints SET runtime_metadata=jsonb_set(coalesce(runtime_metadata,'{}'::jsonb),'{native_live_resume_tail}',${JSON.stringify(tail)}::jsonb)
        WHERE id=${c.id}::uuid AND user_id=${userId}::uuid RETURNING id`);
      if (rows.length !== 1) throw conflict();
    }
    const rows = await tx.execute(sql`UPDATE native_live_runtime_events SET payload=${JSON.stringify({ ...terminal, ...(outcome === "stale" ? {} : { result }) })}::jsonb
      WHERE id=${identity.receiptId}::uuid AND user_id=${userId}::uuid AND prepare_id=${identity.sourcePrepareId}::uuid AND payload->>'phase'='prepared' RETURNING id`);
    if (rows.length !== 1) throw conflict();
    return { outcome, duplicate: false, providerCheckpointId: checkpoint };
  });
}
