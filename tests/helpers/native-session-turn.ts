import { sql } from 'drizzle-orm';
import type { createDatabase } from '../../src/database/client.js';
type Executor = Pick<ReturnType<typeof createDatabase>['db'], 'execute'>;

/** Synthetic fixture slot mutation; deliberately independent of production writers. */
export async function setTestNativeSessionTurn(db: Executor, conversationId: string, turn: {
  prepareId?: string | null; anchor?: string | null;
}) {
  await db.execute(sql`INSERT INTO native_live_session_owners AS o
    (conversation_id,user_id,owner,owner_revision,writer_generation,turn_prepare_id,turn_anchor_message_id)
    SELECT c.id,c.user_id,
      CASE WHEN c.provider_metadata->'nativeSessionSource'->>'owner'='desktop' THEN 'desktop' ELSE 'leileios' END,
      c.provider_metadata->'nativeSessionSource'->>'revision',gen_random_uuid(),
      ${turn.prepareId === undefined ? sql`existing.turn_prepare_id` : sql`${turn.prepareId}::uuid`},
      ${turn.anchor === undefined ? sql`existing.turn_anchor_message_id` : sql`${turn.anchor}::uuid`}
    FROM conversations c LEFT JOIN native_live_session_owners existing ON existing.conversation_id=c.id AND existing.user_id=c.user_id
    WHERE c.id=${conversationId}::uuid
    ON CONFLICT (conversation_id) DO UPDATE SET turn_prepare_id=EXCLUDED.turn_prepare_id,
      turn_anchor_message_id=EXCLUDED.turn_anchor_message_id`);
}
export function testNativeSessionTurnSql(alias: string) {
  const c=sql.identifier(alias);
  return {
    prepareId: sql<string|null>`(SELECT o.turn_prepare_id::text FROM native_live_session_owners o WHERE o.conversation_id=${c}.id AND o.user_id=${c}.user_id)`,
    anchor: sql<string|null>`(SELECT o.turn_anchor_message_id::text FROM native_live_session_owners o WHERE o.conversation_id=${c}.id AND o.user_id=${c}.user_id)`,
  };
}

/** Fixture-only conversion for tests that deliberately seed historical JSON.
 * Production ownership writers never read these obsolete copies. */
export async function syncTestNativeSessionOwner(db: Executor,input:{userId:string;conversationId:string}) {
  await db.execute(sql`INSERT INTO native_live_session_owners AS o
    (conversation_id,user_id,owner,owner_revision,writer_generation)
    SELECT c.id,c.user_id,coalesce(c.provider_metadata->'nativeSessionSource'->>'owner','leileios'),
      CASE WHEN c.provider_metadata->'nativeSessionSource' ? 'revision' THEN c.provider_metadata->'nativeSessionSource'->>'revision' ELSE existing.owner_revision END,gen_random_uuid()
    FROM conversations c LEFT JOIN native_live_session_owners existing ON existing.conversation_id=c.id AND existing.user_id=c.user_id
    WHERE c.id=${input.conversationId}::uuid AND c.user_id=${input.userId}::uuid
    ON CONFLICT (conversation_id) DO UPDATE SET owner=EXCLUDED.owner,owner_revision=EXCLUDED.owner_revision`);
}
