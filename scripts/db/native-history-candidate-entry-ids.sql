-- READ ONLY: enumerate individual candidate row identities for the scoped Railway cleanup.
-- Metadata only: no JSONB bodies, attachment objects, Mac files, writes or deletes.
-- This is an inventory, NOT an approved deletion allowlist.
-- Save output outside Git with mode 0600; verify it against a new encrypted backup.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

SELECT e.user_id, e.provider_session_id AS session_id, e.subpath,
       e.id AS entry_id, e.append_batch_id, e.append_ordinal,
       pg_column_size(e.entry) AS jsonb_bytes, e.created_at,
       s.state, s.preserve_external_session
FROM native_live_provider_session_entries e
LEFT JOIN native_live_provider_session_store_status s
  ON s.user_id = e.user_id AND s.provider_session_id = e.provider_session_id
WHERE e.subpath = '' OR e.subpath LIKE 'native-history-assets/%'
ORDER BY e.user_id, e.provider_session_id, e.subpath, e.id;

-- Separate snapshot identities; do not combine their messages with canonical
-- conversation_messages or select full message contents in the audit output.
SELECT s.user_id, s.conversation_id, s.source_provider_session_id,
       s.message_count, pg_column_size(s.messages) AS jsonb_bytes,
       c.origin, c.lifecycle_status, c.current_head_message_id,
       c.provider_metadata->'nativeSessionSource'->>'mode' AS source_mode
FROM native_live_conversation_history_snapshots s
LEFT JOIN conversations c ON c.id = s.conversation_id AND c.user_id = s.user_id
ORDER BY s.user_id, s.conversation_id;

ROLLBACK;
