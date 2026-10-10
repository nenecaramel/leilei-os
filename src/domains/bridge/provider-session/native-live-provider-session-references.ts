import { sql, type SQL } from 'drizzle-orm';

/** Native UUIDs address physical files; serialize preservation across client aliases. */
export function providerSessionOwnershipLock(input: {
    providerSessionId: string | SQL;
    wait: boolean;
}): SQL {
    const key = sql`hashtextextended('leileios-native-session:' || ${input.providerSessionId}::text, 0)`;
    return input.wait ? sql`pg_advisory_xact_lock(${key})` : sql`pg_try_advisory_xact_lock(${key})`;
}
/** All execution-state references, not just the conversation being purged. */
export function providerSessionUnreferenced(input: {
    userId: string | SQL;
    providerSessionId: string | SQL;
    excludeMessageIds?: readonly string[];
    excludeConversationId?: string;
}): SQL {
    const excluded = input.excludeMessageIds ?? [];
    // Callers may pass an outer checkpoint.provider_session_id. Do not shadow
    // that correlated alias inside the surviving-checkpoint subquery.
    const messageFilter = excluded.length ? sql `AND surviving_checkpoint.canonical_message_id NOT IN (${sql.join(excluded.map(id => sql `${id}::uuid`), sql `, `)})` : sql ``;
    const checkpointConversation = input.excludeConversationId ? sql `AND surviving_checkpoint.conversation_id <> ${input.excludeConversationId}::uuid` : sql ``;
    const bootstrapConversation = input.excludeConversationId ? sql `AND bootstrap.conversation_id <> ${input.excludeConversationId}::uuid` : sql ``;
    const preparationConversation = input.excludeConversationId ? sql `AND preparation.conversation_id <> ${input.excludeConversationId}::uuid` : sql ``;
    const compactConversation = input.excludeConversationId ? sql `AND compact.conversation_id <> ${input.excludeConversationId}::uuid` : sql ``;
    return sql `
 NOT EXISTS (
   SELECT 1 FROM native_live_provider_session_store_status AS preserved_native_session
   WHERE preserved_native_session.provider_session_id = ${input.providerSessionId}
     AND preserved_native_session.preserve_external_session = true
 ) AND NOT EXISTS (
   SELECT 1 FROM conversation_provider_session_checkpoints AS surviving_checkpoint
   WHERE surviving_checkpoint.user_id = ${input.userId}::uuid
     AND surviving_checkpoint.provider = 'claude_code'
     AND surviving_checkpoint.provider_session_id = ${input.providerSessionId}
     ${messageFilter} ${checkpointConversation}
 ) AND NOT EXISTS (
   SELECT 1 FROM native_live_conversation_provider_bootstraps AS bootstrap
   WHERE bootstrap.user_id = ${input.userId}::uuid
     AND bootstrap.provider = 'claude_code'
     AND bootstrap.source_provider_session_id = ${input.providerSessionId}
     AND bootstrap.consumed_at IS NULL ${bootstrapConversation}
 ) AND NOT EXISTS (
   SELECT 1 FROM native_live_turn_preparations AS preparation
   WHERE preparation.user_id = ${input.userId}::uuid
     AND preparation.status = 'prepared'
     AND (preparation.parent_provider_session_id = ${input.providerSessionId}
       OR preparation.provider_session_id = ${input.providerSessionId})
     ${preparationConversation}
 ) AND NOT EXISTS (
   SELECT 1 FROM native_live_manual_compactions AS compact
   WHERE compact.user_id = ${input.userId}::uuid
     AND compact.provider_session_id = ${input.providerSessionId}
     AND compact.status IN ('pending','reserved') ${compactConversation}
 )`;
}
