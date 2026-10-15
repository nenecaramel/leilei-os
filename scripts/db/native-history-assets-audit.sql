-- Read-only report: historical native image/document JSONB copies by session.
-- Does not write anything to Postgres, Railway or Claude files.
WITH assets AS (
  SELECT user_id, provider_session_id, count(*)::bigint AS rows,
    sum(pg_column_size(entry))::bigint AS bytes, min(created_at) AS first_seen,
    max(created_at) AS last_seen
  FROM native_live_provider_session_entries
  WHERE subpath LIKE 'native-history-assets/%'
  GROUP BY user_id, provider_session_id
)
SELECT a.provider_session_id, a.rows, pg_size_pretty(a.bytes) AS inline_jsonb,
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.user_id=a.user_id AND c.origin='native_live' AND c.lifecycle_status='active'
      AND c.provider_metadata->'nativeSessionSource'->>'mode'='continuation'
      AND c.provider_metadata->'nativeSessionSource'->>'sessionId'=a.provider_session_id
  ) AS active_continuation,
  EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.user_id=a.user_id AND c.origin='native_live' AND c.lifecycle_status='active'
      AND (c.provider_metadata->'nativeSessionSource'->>'sessionId'=a.provider_session_id
        OR (jsonb_typeof(c.provider_metadata->'nativeSessionSource'->'lineage')='array'
          AND (c.provider_metadata->'nativeSessionSource'->'lineage') ? a.provider_session_id))
      AND c.provider_metadata->'nativeSessionSource'->>'mode' IS DISTINCT FROM 'continuation'
  ) AS legacy_history_dependent,
  a.first_seen, a.last_seen
FROM assets a ORDER BY a.bytes DESC;
