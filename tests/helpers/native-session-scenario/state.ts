import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { createDatabase } from '../../../src/database/client.js';

export type Database = ReturnType<typeof createDatabase>['db'];
export type SessionRow = {
  owner: 'leileios' | 'desktop' | 'releasing'; ownerRevision: string | null;
  generation: string; prepareId: string | null; anchor: string | null;
};
export type Message = { id: string; parent: string | null; role: string; status: string };
// This is the only adapter allowed to read owner, turn slot or generation.
// Deliberately no provider_metadata access: PR 3b removes the JSON slot.
export async function readState(db: Database, userId: string, conversationId: string) {
  const [row] = await db.execute<SessionRow & { head: string | null }>(sql`
    SELECT o.owner,o.owner_revision AS "ownerRevision",o.writer_generation::text AS generation,
      o.turn_prepare_id::text AS "prepareId",o.turn_anchor_message_id::text AS anchor,
      c.current_head_message_id::text AS head
    FROM conversations c JOIN native_live_session_owners o ON o.conversation_id=c.id AND o.user_id=c.user_id
    WHERE c.user_id=${userId}::uuid AND c.id=${conversationId}::uuid`);
  assert.ok(row, 'owner row exists');
  const messages = await db.execute<Message>(sql`SELECT id::text,parent_message_id::text AS parent,role,status
    FROM conversation_messages WHERE user_id=${userId}::uuid AND conversation_id=${conversationId}::uuid ORDER BY created_at,id`);
  const [counts] = await db.execute<{ messages: number; checkpoints: number; events: number; receipts: number }>(sql`
    SELECT (SELECT count(*)::int FROM conversation_messages WHERE user_id=${userId}::uuid AND conversation_id=${conversationId}::uuid) AS messages,
      (SELECT count(*)::int FROM conversation_provider_session_checkpoints WHERE user_id=${userId}::uuid AND conversation_id=${conversationId}::uuid) AS checkpoints,
      (SELECT count(*)::int FROM native_live_runtime_events e JOIN native_live_turn_preparations p ON p.id=e.prepare_id
        WHERE p.user_id=${userId}::uuid AND p.conversation_id=${conversationId}::uuid) AS events,
      (SELECT count(*)::int FROM native_live_runtime_events e JOIN native_live_turn_preparations p ON p.id=e.prepare_id
        WHERE p.user_id=${userId}::uuid AND p.conversation_id=${conversationId}::uuid
          AND e.payload->>'kind'='persistent_background_receipt_v1') AS receipts`);
  return { row, messages, counts };
}
export type Snapshot = Awaited<ReturnType<typeof readState>>;

export function assertCanonical(snapshot: Snapshot, expectedHead: string | null, expectedRoot: string | null, expectedParents: ReadonlyMap<string,string|null>) {
  assert.equal(snapshot.row.head, expectedHead, 'canonical head matches the reference model');
  const byId = new Map(snapshot.messages.map(m => [m.id, m]));
  // Historical edit/retry branches are legitimate. Every retained message must
  // still reach a root; "no orphan" does not mean deleting those old branches.
  for (const message of snapshot.messages) {
    assert.ok(expectedParents.has(message.id),`canonical shape: unexpected message ${message.id}`);
    assert.equal(message.parent,expectedParents.get(message.id),`canonical shape: expected parent of ${message.id}`);
    const seen = new Set<string>();
    let cursor: Message | undefined = message;
    while (cursor) {
      assert.ok(!seen.has(cursor.id), 'canonical shape: no parent cycle');
      seen.add(cursor.id);
      if (cursor.parent === null) break;
      assert.ok(byId.has(cursor.parent), `canonical shape: orphan ${cursor.id}`);
      cursor = byId.get(cursor.parent);
    }
  }
  if (expectedHead !== null) {
    assert.ok(byId.has(expectedHead), 'canonical head exists');
    let root=byId.get(expectedHead)!;
    while(root.parent!==null)root=byId.get(root.parent)!;
    assert.equal(root.id,expectedRoot,'canonical path reaches the expected root (detached prepared U is not a committed root)');
  } else assert.equal(expectedRoot,null,'empty path has no committed root');
}
