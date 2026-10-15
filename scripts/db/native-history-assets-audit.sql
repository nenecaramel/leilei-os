-- READ ONLY. Identify exact user + Session + subpath for potential removal.
-- Never interpret total size alone as evidence of safe deletion.
WITH copies AS (
  SELECT e.user_id, e.provider_session_id, e.subpath,
    count(*)::bigint AS rows, sum(pg_column_size(e.entry))::bigint AS jsonb_bytes,
    min(e.id) AS min_entry_id, max(e.id) AS max_entry_id,
    min(e.created_at) AS earliest, max(e.created_at) AS latest
  FROM native_live_provider_session_entries e
  WHERE e.subpath = '' OR e.subpath LIKE 'native-history-assets/%'
  GROUP BY e.user_id, e.provider_session_id, e.subpath
), identified AS (
  SELECT a.*,
    s.state, s.preserve_external_session,
    EXISTS (SELECT 1 FROM conversations c
      WHERE c.user_id=a.user_id AND c.origin='native_live'
        AND c.lifecycle_status='active'
        AND (c.provider_metadata->'nativeSessionSource'->>'sessionId'=a.provider_session_id
          OR (jsonb_typeof(c.provider_metadata->'nativeSessionSource'->'lineage')='array'
            AND (c.provider_metadata->'nativeSessionSource'->'lineage') ? a.provider_session_id))
        AND c.provider_metadata->'nativeSessionSource'->>'mode'='continuation'
    ) AS continuation_reference,
    EXISTS (SELECT 1 FROM conversations c
      WHERE c.user_id=a.user_id AND c.origin='native_live'
        AND c.lifecycle_status='active'
        AND (c.provider_metadata->'nativeSessionSource'->>'sessionId'=a.provider_session_id
          OR (jsonb_typeof(c.provider_metadata->'nativeSessionSource'->'lineage')='array'
            AND (c.provider_metadata->'nativeSessionSource'->'lineage') ? a.provider_session_id))
        AND c.provider_metadata->'nativeSessionSource'->>'mode' IS DISTINCT FROM 'continuation'
    ) AS legacy_full_history_reference,
    EXISTS (SELECT 1 FROM conversation_provider_session_checkpoints cp
      WHERE cp.user_id=a.user_id AND cp.provider_session_id=a.provider_session_id
    ) AS canonical_checkpoint_reference,
    EXISTS (SELECT 1 FROM native_live_conversation_provider_bootstraps b
      WHERE b.user_id=a.user_id AND b.source_provider_session_id=a.provider_session_id
        AND b.consumed_at IS NULL
    ) AS unconsumed_bootstrap,
    EXISTS (SELECT 1 FROM native_live_turn_preparations t
      WHERE t.user_id=a.user_id
        AND (t.parent_provider_session_id=a.provider_session_id OR t.provider_session_id=a.provider_session_id)
        AND t.dispatch_status IN ('staged','pending','reserved','executing','delivery_unknown')
    ) AS unfinished_turn
  FROM copies a
  LEFT JOIN native_live_provider_session_store_status s
    ON s.user_id=a.user_id AND s.provider_session_id=a.provider_session_id
)
SELECT user_id, provider_session_id, subpath, rows,
  jsonb_bytes, pg_size_pretty(jsonb_bytes) AS jsonb_pretty,
  min_entry_id, max_entry_id, state, preserve_external_session,
  continuation_reference, legacy_full_history_reference,
  canonical_checkpoint_reference, unconsumed_bootstrap, unfinished_turn,
  earliest, latest
FROM identified ORDER BY jsonb_bytes DESC, user_id, provider_session_id, subpath;

-- The exact one-row old Desktop display snapshot, and its owning conversation.
SELECT s.user_id, s.conversation_id, s.source_provider_session_id,
  s.message_count, pg_column_size(s.messages) AS jsonb_bytes,
  pg_size_pretty(pg_column_size(s.messages)::bigint) AS jsonb_pretty,
  c.lifecycle_status, c.origin,
  c.current_head_message_id,
  c.provider_metadata->'nativeSessionSource'->>'mode' AS session_mode
FROM native_live_conversation_history_snapshots s
LEFT JOIN conversations c ON c.id=s.conversation_id AND c.user_id=s.user_id
ORDER BY pg_column_size(s.messages) DESC;
