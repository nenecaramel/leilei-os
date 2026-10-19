import { isDeepStrictEqual } from "node:util";
import { and, eq, sql } from "drizzle-orm";
import type { createDatabase } from "../../../database/client.js";
import { nativeLiveRuntimeControls } from "../../../database/schema.js";
import { NativeLiveRuntimeControlError, mapControl } from "./native-live-runtime-control.js";

type Database = ReturnType<typeof createDatabase>["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type NativeLiveTaskBinding = { conversationId: string; providerSessionId: string; generationId: string };
type Source = { conversationId: string; providerSessionId: string; listenerInstanceId: string };
const denied = () => new NativeLiveRuntimeControlError("TURN_NOT_ACTIVE", "This session no longer accepts task controls.");
const invalid = () => new NativeLiveRuntimeControlError("CONTROL_INVALID", "Task control requires list, or output/stop with the exact task handle and generation.");
export function taskPayload(value: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(value);
  if (value.action === "list" && keys.length === 1) return { action: "list" };
  if ((value.action === "output" || value.action === "stop") && keys.length === 4
    && keys.every(key => ["action", "taskId", "handle", "generationId"].includes(key))
    && [value.taskId, value.handle, value.generationId].every(v => typeof v === "string" && v.length > 0 && v.length <= 256)
    && /^[0-9a-f-]{36}$/i.test(String(value.generationId))) return { ...value };
  throw invalid();
}
/** Same surviving branch + live exclusive writer; no lease acquisition or history import. */
export async function taskSource(tx: Transaction, input: { userId: string; prepareId: string; listenerInstanceId?: string }): Promise<Source | null> {
  await tx.execute(sql`SET LOCAL statement_timeout='3s'`);
  await tx.execute(sql`SET LOCAL lock_timeout='1s'`);
  const [source] = await tx.execute<{ conversationId:string;providerSessionId:string;listenerInstanceId:string;anchorId:string;active:boolean;fresh:boolean }>(sql`
    SELECT p.conversation_id::text AS "conversationId", coalesce(p.provider_session_id,
        (SELECT e.provider_session_id FROM native_live_runtime_events e WHERE e.user_id=p.user_id AND e.prepare_id=p.id AND e.event_type='session' AND e.provider_session_id IS NOT NULL ORDER BY e.sequence DESC LIMIT 1), p.parent_provider_session_id) AS "providerSessionId",
      p.reserved_by::text AS "listenerInstanceId", coalesce(p.assistant_message_id,p.canonical_user_message_id,(p.wake_context->>'source_head_message_id')::uuid)::text AS "anchorId",
      p.status='prepared' AS active, p.runtime_mode='new' AS fresh
    FROM native_live_turn_preparations p WHERE p.id=${input.prepareId}::uuid AND p.user_id=${input.userId}::uuid AND p.reserved_by IS NOT NULL
      AND ((p.status='finalized_success' AND p.dispatch_status='completed' AND p.assistant_message_id IS NOT NULL)
        OR (p.status='prepared' AND p.dispatch_status IN ('executing','delivery_unknown') AND p.operation IN ('send','wake') AND p.runtime_mode IN ('new','resume') AND p.reservation_expires_at>clock_timestamp())) FOR UPDATE OF p`);
  if (!source || !source.providerSessionId || (input.listenerInstanceId && source.listenerInstanceId !== input.listenerInstanceId)) return null;
  await tx.execute(sql`SELECT id FROM conversations WHERE id=${source.conversationId}::uuid AND user_id=${input.userId}::uuid FOR UPDATE`);
  const [lease] = await tx.execute(sql`SELECT user_id FROM native_live_runtime_listener_leases WHERE user_id=${input.userId}::uuid AND dispatch_target='claude_code'
    AND listener_instance_id=${source.listenerInstanceId}::uuid AND lease_expires_at>clock_timestamp() FOR SHARE`);
  if (!lease) return null;
  const [valid] = await tx.execute(sql`WITH RECURSIVE path AS (
    SELECT m.id, m.parent_message_id, 0 AS depth, ARRAY[m.id] AS visited FROM conversation_messages m JOIN conversations c ON c.current_head_message_id=m.id
      WHERE c.id=${source.conversationId}::uuid AND c.user_id=${input.userId}::uuid AND m.user_id=c.user_id AND m.conversation_id=c.id
    UNION ALL SELECT m.id,m.parent_message_id,p.depth+1,p.visited||m.id FROM path p JOIN conversation_messages m ON m.id=p.parent_message_id
      WHERE m.user_id=${input.userId}::uuid AND m.conversation_id=${source.conversationId}::uuid AND p.depth<4095 AND NOT m.id=ANY(p.visited)
  ) SELECT c.id FROM conversations c JOIN path origin ON origin.id=${source.anchorId}::uuid
    WHERE c.id=${source.conversationId}::uuid AND c.user_id=${input.userId}::uuid AND c.origin='native_live' AND c.lifecycle_status='active'
      AND coalesce(c.provider_metadata->'nativeSessionSource'->>'owner','leileios')='leileios'
      AND (${source.active}=false OR c.current_head_message_id=${source.anchorId}::uuid)
      AND ((${source.active}=true AND ${source.fresh}=true AND EXISTS (SELECT 1 FROM conversation_messages u WHERE u.id=${source.anchorId}::uuid AND u.parent_message_id IS NULL))
        OR (SELECT cp.provider_session_id FROM path p JOIN conversation_provider_session_checkpoints cp ON cp.canonical_message_id=p.id
          WHERE cp.user_id=c.user_id AND cp.conversation_id=c.id AND cp.provider='claude_code' ORDER BY p.depth LIMIT 1)=${source.providerSessionId})
      AND (coalesce(c.provider_metadata->'nativeSessionSource'->>'mode','')<>'continuation'
        OR ((c.provider_metadata->'nativeSessionSource'->>'sessionId' IS NULL
            OR c.provider_metadata->'nativeSessionSource'->>'sessionId'=${source.providerSessionId}
            OR (${source.active}=false
              AND c.provider_metadata->'nativeSessionSource'->>'revision' ~ '^[0-9a-f]{64}$'
              AND EXISTS (SELECT 1 FROM conversation_provider_session_checkpoints child
                WHERE child.user_id=c.user_id AND child.conversation_id=c.id AND child.provider='claude_code'
                  AND child.canonical_message_id=${source.anchorId}::uuid
                  AND child.provider_session_id=${source.providerSessionId}
                  AND child.runtime_metadata->'native_live_generation'->>'source_revision'
                    =c.provider_metadata->'nativeSessionSource'->>'revision')))
          AND (c.provider_metadata->'nativeSessionSource'->>'headMessageId' IS NULL
            OR EXISTS (SELECT 1 FROM path floor WHERE floor.id::text=c.provider_metadata->'nativeSessionSource'->>'headMessageId' AND floor.depth>origin.depth))))
      AND NOT EXISTS (SELECT 1 FROM native_live_turn_preparations branch WHERE branch.user_id=c.user_id AND branch.conversation_id=c.id
        AND branch.status='prepared' AND (branch.operation IN ('edit','retry') OR branch.runtime_mode='fork')
        AND branch.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')) LIMIT 1`);
  return valid ? { conversationId:source.conversationId,providerSessionId:source.providerSessionId,listenerInstanceId:source.listenerInstanceId } : null;
}

export async function createTaskControl(db: Database, input: { userId: string; prepareId: string; controlId: string; payload: Record<string, unknown> }) {
  const payload = taskPayload(input.payload);
  return db.transaction(async tx => {
    const source = await taskSource(tx, input); if (!source) throw denied();
    const enriched = { ...payload, ...source };
    const [existing] = await tx.select().from(nativeLiveRuntimeControls).where(eq(nativeLiveRuntimeControls.id, input.controlId));
    if (existing) {
      if (existing.userId !== input.userId || existing.prepareId !== input.prepareId || existing.kind !== "task" || !isDeepStrictEqual(payload.action === "list" ? { ...existing.payload, generationId: undefined } : existing.payload, payload.action === "list" ? { ...enriched, generationId: undefined } : enriched)) throw new NativeLiveRuntimeControlError("CONTROL_CONFLICT", "Control id is already bound to different data.");
      return { outcome: "idempotent" as const, control: mapControl(existing) };
    }
    // No replay backlog: stale pending controls expire before a later listener can take them.
    const [created] = await tx.insert(nativeLiveRuntimeControls).values({ id: input.controlId, userId: input.userId, prepareId: input.prepareId, kind: "task", payload: enriched }).returning();
    return { outcome: "created" as const, control: mapControl(created!) };
  });
}
export async function readTaskControl(db: Database, input: { userId: string; prepareId: string; controlId: string }) {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(nativeLiveRuntimeControls).where(and(eq(nativeLiveRuntimeControls.id,input.controlId),eq(nativeLiveRuntimeControls.userId,input.userId),eq(nativeLiveRuntimeControls.prepareId,input.prepareId),eq(nativeLiveRuntimeControls.kind,"task")));
    if (!row) return null;
    if (!await taskSource(tx,input)) throw denied();
    return mapControl(row);
  });
}
export async function reserveTaskControl(db: Database, input: { userId: string; listenerInstanceId: string; bindings: NativeLiveTaskBinding[] }) {
  if (input.bindings.length > 4) throw invalid();
  // Read candidates without row locks: every mutation below locks source -> conversation -> lease -> control.
  const candidates = await db.select().from(nativeLiveRuntimeControls).where(and(eq(nativeLiveRuntimeControls.userId,input.userId),eq(nativeLiveRuntimeControls.kind,"task"),eq(nativeLiveRuntimeControls.status,"pending"),sql`${nativeLiveRuntimeControls.createdAt}>clock_timestamp()-interval '15 seconds'`)).orderBy(nativeLiveRuntimeControls.createdAt).limit(32);
  for (const row of candidates) {
    const binding = input.bindings.find(b => b.conversationId===row.payload.conversationId && b.providerSessionId===row.payload.providerSessionId
      && (!row.payload.generationId || b.generationId===row.payload.generationId));
    if (!binding) continue;
    const reserved = await db.transaction(async tx => {
      const source = await taskSource(tx,{ ...input,prepareId:row.prepareId }); if (!source) return null;
      const [updated] = await tx.update(nativeLiveRuntimeControls).set({ status:"reserved", reservedBy:input.listenerInstanceId,reservedAt:new Date(),updatedAt:new Date(),payload:{ ...row.payload,generationId:binding.generationId } })
        .where(and(eq(nativeLiveRuntimeControls.id,row.id),eq(nativeLiveRuntimeControls.status,"pending"),sql`${nativeLiveRuntimeControls.createdAt}>clock_timestamp()-interval '15 seconds'`)).returning();
      return updated ? mapControl(updated) : null;
    });
    if (reserved) return reserved;
  }
  return null;
}

export function validateTaskReceipt(payload:Record<string,unknown>,receipt:Record<string,unknown>):Record<string,unknown> {
  if(receipt.generationId!==payload.generationId)throw invalid();
  if(payload.action==="list") {
    if(!Array.isArray(receipt.tasks)||receipt.tasks.length>1152)throw invalid();
    for(const value of receipt.tasks){
      if(!value||typeof value!=="object"||Array.isArray(value))throw invalid();
      const task=value as Record<string,unknown>;
      if(typeof task.taskId!=="string"||task.taskId.length>512||typeof task.handle!=="string"||task.handle.length>256||typeof task.active!=="boolean"||typeof task.status!=="string")throw invalid();
    }
  }else if(payload.action==="output"){
    if(typeof receipt.output!=="string"||Buffer.byteLength(receipt.output,"utf8")>8192||!Number.isSafeInteger(receipt.totalBytes)||(receipt.totalBytes as number)<Buffer.byteLength(receipt.output,"utf8")||typeof receipt.truncated!=="boolean")throw invalid();
  }else if(payload.action!=="stop"||receipt.accepted!==true)throw invalid();
  if(Buffer.byteLength(JSON.stringify(receipt),"utf8")>2*1024*1024)throw invalid();
  return receipt;
}
