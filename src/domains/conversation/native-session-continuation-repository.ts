import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { createDatabase } from '../../database/client.js';
import { conversations, nativeLiveTurnPreparations, nativeLiveManualCompactions } from '../../database/schema.js';
import { inFlightConversationTurns } from './native-live-conversation-repository.js';
import { DrizzleNativeLiveProviderSessionStoreRepository } from '../bridge/provider-session/native-live-provider-session-store.js';
import { providerSessionOwnershipLock } from '../bridge/provider-session/native-live-provider-session-references.js';
import { nativeResumeCheckpointSql, nativeResumeTailValidSql } from '../bridge/turn/native-live-resume-checkpoint.js';
import { syncNativeSessionOwner, readNativeSessionOwner } from '../bridge/turn/turn-repository/session-owner.js';

type Database = ReturnType<typeof createDatabase>['db'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const fail = (code: string) => Object.assign(new Error(code), { code });
export type NativeContinuationBinding = {
  schemaVersion: 1; mode: 'continuation'; sessionId: string; checkpointId: string;
  /** Ownership generation rotates even when native bytes have not changed. */
  revision: string; nativeRevision: string; previousRevision: string | null;
  effectiveWorkingDirectory: string; headMessageId: string | null; owner: 'leileios' | 'releasing' | 'desktop';
  lineage: string[];
};
export function nativeContinuationBinding(metadata: Record<string, unknown>): NativeContinuationBinding | null {
  const s = metadata.nativeSessionSource as NativeContinuationBinding | undefined;
  if (s?.mode !== 'continuation') return null;
  if (s.schemaVersion !== 1 || !uuid.test(s.sessionId) || !uuid.test(s.checkpointId) || !hash.test(s.revision)
    || !hash.test(s.nativeRevision) || !(s.previousRevision === null || hash.test(s.previousRevision))
    || !(s.headMessageId === null || uuid.test(s.headMessageId)) || !isAbsolute(s.effectiveWorkingDirectory)
    || !['leileios', 'releasing', 'desktop'].includes(s.owner) || !Array.isArray(s.lineage) || s.lineage.length > 1000 || !s.lineage.every(id => uuid.test(id))) throw fail('NATIVE_SOURCE_BINDING_REQUIRED');
  return s;
}
export type NativeContinuationInput = {
  userId: string; conversationId: string; sessionId: string; checkpointId: string; revision: string;
  effectiveWorkingDirectory: string; expectedHeadMessageId: string | null; expectedRevision: string | null;
  /** UUID-only execution ancestry attested by the authenticated Mac reader, never message bodies. */
  checkpointIds: string[]; completedTurnCheckpointIds: string[];
};
export function validateNativeContinuationInput(input: NativeContinuationInput) {
  if (![input.userId, input.conversationId, input.sessionId, input.checkpointId].every(id => typeof id === 'string' && uuid.test(id))
    || !(input.expectedHeadMessageId === null || typeof input.expectedHeadMessageId === 'string' && uuid.test(input.expectedHeadMessageId))
    || !(input.expectedRevision === null || typeof input.expectedRevision === 'string' && hash.test(input.expectedRevision))
    || typeof input.revision !== 'string' || !hash.test(input.revision) || typeof input.effectiveWorkingDirectory !== 'string'
    || !isAbsolute(input.effectiveWorkingDirectory) || input.effectiveWorkingDirectory.length > 4096
    || !Array.isArray(input.checkpointIds) || !input.checkpointIds.length || input.checkpointIds.length > 100_000
    || !input.checkpointIds.every(id => typeof id === 'string' && uuid.test(id)) || new Set(input.checkpointIds).size !== input.checkpointIds.length
    || !input.checkpointIds.includes(input.checkpointId) || !Array.isArray(input.completedTurnCheckpointIds)
    || !input.completedTurnCheckpointIds.length || input.completedTurnCheckpointIds.length > 1000
    || input.completedTurnCheckpointIds[0] !== input.checkpointId
    || input.completedTurnCheckpointIds.some(id => !input.checkpointIds.includes(id))) throw fail('INVALID_NATIVE_PROJECTION');
}

/** Canonical UI history and the native execution cursor are deliberately separate. */
export async function readNativeContinuationState(db: Pick<Database, 'execute'>, input: { userId: string; conversationId: string; sessionId: string }) {
  if (![input.userId, input.conversationId, input.sessionId].every(id => uuid.test(id))) throw fail('INVALID_NATIVE_PROJECTION');
  const [row] = await db.execute<{
    user_id: string; origin: string; lifecycle_status: string; head: string | null; metadata: Record<string, unknown>;
    session: string | null; base_checkpoint: string | null; checkpoint: string | null; cwd: string | null;
  }>(sql`SELECT c.user_id, c.origin, c.lifecycle_status, c.current_head_message_id AS head, c.provider_metadata AS metadata,
      cp.provider_session_id AS session, cp.provider_checkpoint_id AS base_checkpoint, ${nativeResumeCheckpointSql('cp', 'c', true, {allowReleasingOwner:true})} AS checkpoint, cp.effective_working_directory AS cwd
    FROM conversations c LEFT JOIN conversation_provider_session_checkpoints cp
      ON cp.user_id = c.user_id AND cp.conversation_id = c.id AND cp.canonical_message_id = c.current_head_message_id AND cp.provider = 'claude_code'
    WHERE c.id = ${input.conversationId}::uuid`);
  if (!row) return { expectedHeadMessageId: null, expectedRevision: null, providerSessionId: null, providerCheckpointId: null, effectiveWorkingDirectory: null, owner: null };
  if (row.user_id !== input.userId || row.origin !== 'native_live' || row.lifecycle_status !== 'active') throw fail('NATIVE_CONVERSATION_NOT_FOUND');
  const source = row.metadata.nativeSessionSource as Partial<NativeContinuationBinding> | undefined;
  const binding = nativeContinuationBinding(row.metadata);
  const atAnchor = binding && row.head === binding.headMessageId;
  return { expectedHeadMessageId: row.head, expectedRevision: source?.revision ?? null,
    providerSessionId: atAnchor ? binding.sessionId : row.session,
    providerCheckpointId: atAnchor ? (row.session === binding.sessionId && row.base_checkpoint === binding.checkpointId
      && row.cwd === binding.effectiveWorkingDirectory ? row.checkpoint : binding.checkpointId) : row.checkpoint,
    effectiveWorkingDirectory: atAnchor ? binding.effectiveWorkingDirectory : row.cwd,
    owner: source?.owner ?? 'leileios' };
}

export const attachNativeContinuation = (db: Database, input: NativeContinuationInput) => changeOwner(db, input, 'leileios');
export const releaseNativeContinuation = (db: Database, input: NativeContinuationInput) => changeOwner(db, input, 'desktop');
async function changeOwner(db: Database, input: NativeContinuationInput, owner: 'leileios' | 'desktop') {
  validateNativeContinuationInput(input);
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('leileios-native-history:' || ${input.conversationId}, 0))`);
    const [existing] = await tx.select().from(conversations).where(eq(conversations.id, input.conversationId)).for('update');
    if (existing && (existing.userId !== input.userId || existing.origin !== 'native_live' || existing.lifecycleStatus !== 'active')) throw fail('NATIVE_CONVERSATION_NOT_FOUND');
    if (!existing && owner === 'desktop') throw fail('NATIVE_CONVERSATION_NOT_FOUND');
    await tx.execute(sql`SELECT ${providerSessionOwnershipLock({ providerSessionId: input.sessionId, wait: true })}`);
    const other = await tx.execute(sql`SELECT c.id FROM conversations c LEFT JOIN conversation_provider_session_checkpoints cp
      ON cp.user_id = c.user_id AND cp.conversation_id = c.id AND cp.canonical_message_id = c.current_head_message_id AND cp.provider = 'claude_code'
      WHERE c.id <> ${input.conversationId}::uuid AND c.origin = 'native_live' AND c.lifecycle_status = 'active'
        AND (cp.provider_session_id = ${input.sessionId} OR c.provider_metadata->'nativeSessionSource'->>'sessionId' = ${input.sessionId}) LIMIT 1`);
    if (other.length) throw fail('NATIVE_SESSION_ALREADY_ATTACHED');
    await assertContinuationIdle(tx, input, owner === 'desktop');
    const state = await readNativeContinuationState(tx, input);
    const source = existing?.providerMetadata.nativeSessionSource as Partial<NativeContinuationBinding> | undefined;
    const same = source?.mode === 'continuation' && source.owner === owner && source.sessionId === input.sessionId
      && source.checkpointId === input.checkpointId && source.nativeRevision === input.revision
      && source.headMessageId === state.expectedHeadMessageId && source.effectiveWorkingDirectory === input.effectiveWorkingDirectory
      && (input.expectedRevision === source.previousRevision || input.expectedRevision === source.revision);
    if (state.expectedHeadMessageId !== input.expectedHeadMessageId || (!same && state.expectedRevision !== input.expectedRevision)) throw fail('STALE_NATIVE_PROJECTION');
    if (existing) {
      if (state.providerSessionId !== input.sessionId || state.effectiveWorkingDirectory !== input.effectiveWorkingDirectory) throw fail('EXPLICIT_BRANCH_SELECTION_REQUIRED');
      if (!state.providerCheckpointId || !input.checkpointIds.includes(state.providerCheckpointId)) throw fail('EXPLICIT_BRANCH_SELECTION_REQUIRED');
      // While LeileiOS owns execution (and on release), only this exact completed
      // turn is allowed. Desktop can add/rewind new turns after its handoff anchor.
      if ((owner === 'desktop' || state.owner !== 'desktop') && !input.completedTurnCheckpointIds.includes(state.providerCheckpointId)) throw fail('CANONICAL_CHECKPOINT_CHANGED');
    }
    await new DrizzleNativeLiveProviderSessionStoreRepository(tx).preserveExternalSession({ userId: input.userId, sessionId: input.sessionId });
    const lineage = [...new Set([...(source?.lineage ?? []), ...(source?.sessionId && source.sessionId !== input.sessionId ? [source.sessionId] : [])])];
    if (lineage.length > 1000) throw fail('EXPLICIT_BRANCH_SELECTION_REQUIRED');
    const binding: NativeContinuationBinding = { schemaVersion: 1, mode: 'continuation', sessionId: input.sessionId,
      checkpointId: input.checkpointId, revision: createHash('sha256').update(randomUUID()).digest('hex'),
      nativeRevision: input.revision, previousRevision: state.expectedRevision, effectiveWorkingDirectory: input.effectiveWorkingDirectory,
      headMessageId: state.expectedHeadMessageId, owner, lineage };
    if (!existing) await tx.insert(conversations).values({ id: input.conversationId, userId: input.userId, origin: 'native_live', lifecycleStatus: 'active', providerMetadata: { nativeSessionSource: binding } });
    else if (!same) await tx.update(conversations).set({ providerMetadata: { ...existing.providerMetadata, nativeSessionSource: binding }, updatedAt: new Date() }).where(eq(conversations.id, input.conversationId));
    await syncNativeSessionOwner(tx, input);
    return { outcome: same ? 'already_current' : 'attached', owner, conversationId: input.conversationId,
      headMessageId: state.expectedHeadMessageId, providerSessionId: input.sessionId, providerCheckpointId: input.checkpointId, inserted: 0 };
  });
}

type Executor = Parameters<Parameters<Database['transaction']>[0]>[0];
export type NativeContinuationReleaseBeginInput = {
  userId: string; conversationId: string; sessionId: string;
  expectedHeadMessageId: string | null; expectedRevision: string | null;
};
export type NativeContinuationReleaseCancelInput = {
  userId: string; conversationId: string; expectedRevision: string;
};
export function validateNativeContinuationReleaseBegin(input: NativeContinuationReleaseBeginInput) {
  if (![input.userId,input.conversationId,input.sessionId].every(id=>typeof id==='string'&&uuid.test(id))
    || !(input.expectedHeadMessageId===null||typeof input.expectedHeadMessageId==='string'&&uuid.test(input.expectedHeadMessageId))
    || !(input.expectedRevision===null||typeof input.expectedRevision==='string'&&hash.test(input.expectedRevision))) throw fail('INVALID_NATIVE_PROJECTION');
}
export function validateNativeContinuationReleaseCancel(input: NativeContinuationReleaseCancelInput) {
  if (![input.userId,input.conversationId].every(id=>typeof id==='string'&&uuid.test(id))
    || typeof input.expectedRevision!=='string'||!hash.test(input.expectedRevision)) throw fail('INVALID_NATIVE_PROJECTION');
}

/** Same lock order as attach/complete. Only execution ownership changes here. */
export async function beginNativeContinuationRelease(db: Database, input: NativeContinuationReleaseBeginInput) {
  validateNativeContinuationReleaseBegin(input);
  return db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('leileios-native-history:' || ${input.conversationId}, 0))`);
    const [c]=await tx.select().from(conversations).where(eq(conversations.id,input.conversationId)).for('update');
    if(!c||c.userId!==input.userId||c.origin!=='native_live'||c.lifecycleStatus!=='active')throw fail('NATIVE_CONVERSATION_NOT_FOUND');
    await tx.execute(sql`SELECT ${providerSessionOwnershipLock({providerSessionId:input.sessionId,wait:true})}`);
    const state=await readNativeContinuationState(tx,input);
    const source=c.providerMetadata.nativeSessionSource as Partial<NativeContinuationBinding>|undefined;
    const owner=await readNativeSessionOwner(tx,input);
    if(state.expectedHeadMessageId!==input.expectedHeadMessageId)throw fail('STALE_NATIVE_PROJECTION');
    if(state.providerSessionId!==input.sessionId)throw fail('EXPLICIT_BRANCH_SELECTION_REQUIRED');
    const same=owner==='releasing' && (input.expectedRevision===source?.previousRevision||input.expectedRevision===source?.revision);
    if(!same&&(owner!=='leileios'||state.expectedRevision!==input.expectedRevision))throw fail('STALE_NATIVE_PROJECTION');
    await assertContinuationIdle(tx,input,true);
    const revision=same?source!.revision!:createHash('sha256').update(randomUUID()).digest('hex');
    if(!same){
      await rebindVerifiedContinuationTail(tx,input,state.expectedRevision,revision);
      await tx.update(conversations).set({providerMetadata:{...c.providerMetadata,nativeSessionSource:{...source,
        owner:'releasing',revision,previousRevision:state.expectedRevision}},updatedAt:new Date()}).where(eq(conversations.id,input.conversationId));
      await syncNativeSessionOwner(tx,input);
    }
    return {outcome:same?'already_current' as const:'releasing' as const,owner:'releasing' as const,
      conversationId:input.conversationId,headMessageId:state.expectedHeadMessageId,providerSessionId:input.sessionId,expectedRevision:revision};
  });
}

/** A failed switch can only undo its own begin revision, never a completed handoff. */
export async function cancelNativeContinuationRelease(db: Database, input: NativeContinuationReleaseCancelInput) {
  validateNativeContinuationReleaseCancel(input);
  return db.transaction(async tx=>{
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('leileios-native-history:' || ${input.conversationId}, 0))`);
    const [c]=await tx.select().from(conversations).where(eq(conversations.id,input.conversationId)).for('update');
    if(!c||c.userId!==input.userId||c.origin!=='native_live'||c.lifecycleStatus!=='active')throw fail('NATIVE_CONVERSATION_NOT_FOUND');
    const source=c.providerMetadata.nativeSessionSource as Partial<NativeContinuationBinding>|undefined;
    const owner=await readNativeSessionOwner(tx,input);
    const same=owner==='leileios'&&source?.previousRevision===input.expectedRevision;
    if(!same&&(owner!=='releasing'||source?.revision!==input.expectedRevision))throw fail('STALE_NATIVE_PROJECTION');
    const revision=same?source!.revision!:createHash('sha256').update(randomUUID()).digest('hex');
    if(!same){
      await rebindVerifiedContinuationTail(tx,input,source!.revision!,revision);
      await tx.update(conversations).set({providerMetadata:{...c.providerMetadata,nativeSessionSource:{...source,
        owner:'leileios',revision,previousRevision:input.expectedRevision}},updatedAt:new Date()}).where(eq(conversations.id,input.conversationId));
      await syncNativeSessionOwner(tx,input);
    }
    return {outcome:same?'already_current' as const:'cancelled' as const,owner:'leileios' as const,conversationId:input.conversationId,expectedRevision:revision};
  });
}

async function assertContinuationIdle(tx: Executor, input:{userId:string;conversationId:string}, background:boolean) {
  const turns=await tx.select({id:nativeLiveTurnPreparations.id}).from(nativeLiveTurnPreparations).where(inFlightConversationTurns(input)).limit(1);
  const compacts=await tx.select({id:nativeLiveManualCompactions.id}).from(nativeLiveManualCompactions).where(and(
    eq(nativeLiveManualCompactions.userId,input.userId),eq(nativeLiveManualCompactions.conversationId,input.conversationId),
    inArray(nativeLiveManualCompactions.status,['pending','reserved']))).limit(1);
  if(turns.length||compacts.length)throw fail('NATIVE_CONVERSATION_BUSY');
  if(background){
    const pending=await tx.execute(sql`SELECT 1 FROM native_live_runtime_events e
      JOIN native_live_turn_preparations p ON p.id=e.prepare_id AND p.user_id=e.user_id
      WHERE p.user_id=${input.userId}::uuid AND p.conversation_id=${input.conversationId}::uuid
        AND e.event_type='runtime' AND e.payload->>'kind'='persistent_background_receipt_v1'
        AND (e.payload->>'phase'='queued' OR (e.payload->>'phase'='prepared' AND (e.payload->>'expiresAt')::timestamptz>clock_timestamp()))
      LIMIT 1`);
    if(pending.length)throw fail('NATIVE_CONVERSATION_BUSY');
  }
}

/** Preserve only an already valid native tail across owner-revision rotation.
 * Old checkpoint generation stamps and background receipts remain untouched.
 */
async function rebindVerifiedContinuationTail(tx: Executor,input:{userId:string;conversationId:string},previousRevision:string|null,revision:string) {
  await tx.execute(sql`UPDATE conversation_provider_session_checkpoints cp
    SET runtime_metadata=jsonb_set(cp.runtime_metadata,'{native_live_resume_tail,source_revision}',to_jsonb(${revision}::text))
    FROM conversations c WHERE cp.conversation_id=c.id AND cp.user_id=c.user_id
      AND c.id=${input.conversationId}::uuid AND c.user_id=${input.userId}::uuid
      AND cp.canonical_message_id=c.current_head_message_id AND cp.provider='claude_code'
      AND (c.provider_metadata->'nativeSessionSource'->>'revision') IS NOT DISTINCT FROM ${previousRevision}::text
      AND ${nativeResumeTailValidSql('cp','c',true,{allowReleasingOwner:true})}`);
}
