-- MANUAL / DESTRUCTIVE. Must NOT run without an independently verified
-- backup and express permission to reclaim old native history copies.
-- This deliberately never touches the main SessionStore, Claude JSONL,
-- message tables, diary, tasks, Memory, or user-uploaded attachments.
-- Precondition: the application already uses PR #1109 continuation mode.
--
-- In ONE transaction, a database administrator can issue:
--   BEGIN;
--   SET LOCAL leileios.asset_reclaim_approved = 'BACKUP_VERIFIED';
--   [run the contents of this file, which deletes at most 200 rows]
--   COMMIT;
--
-- By default the safety guard below ALWAYS refuses deletion.
DO $guard$
BEGIN
  IF current_setting('leileios.asset_reclaim_approved', true)
       IS DISTINCT FROM 'BACKUP_VERIFIED' THEN
    RAISE EXCEPTION 'Refusing legacy asset deletion: verified backup and explicit transaction approval required';
  END IF;
END
$guard$;

-- A candidate must be bound to an active continuation-only session; a
-- concurrent active legacy conversation referencing that session, including
-- through lineage, prevents deletion.
WITH candidate AS MATERIALIZED (
  SELECT e.id
  FROM native_live_provider_session_entries e
  WHERE e.subpath LIKE 'native-history-assets/%'
    AND e.created_at < TIMESTAMPTZ '2026-10-15 17:18:21+00'
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.user_id=e.user_id AND c.origin='native_live'
        AND c.lifecycle_status='active'
        AND c.provider_metadata->'nativeSessionSource'->>'mode'='continuation'
        AND c.provider_metadata->'nativeSessionSource'->>'sessionId'=e.provider_session_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.user_id=e.user_id AND c.origin='native_live'
        AND c.lifecycle_status='active'
        AND (
          c.provider_metadata->'nativeSessionSource'->>'sessionId'=e.provider_session_id
          OR (jsonb_typeof(c.provider_metadata->'nativeSessionSource'->'lineage')='array'
            AND (c.provider_metadata->'nativeSessionSource'->'lineage') ? e.provider_session_id)
        )
        AND c.provider_metadata->'nativeSessionSource'->>'mode' IS DISTINCT FROM 'continuation'
    )
  ORDER BY e.id LIMIT 200
  FOR UPDATE OF e SKIP LOCKED
), removed AS (
  DELETE FROM native_live_provider_session_entries e
  USING candidate c
  WHERE e.id=c.id
  RETURNING pg_column_size(e.entry) AS bytes
)
SELECT count(*)::bigint AS deleted_rows,
       pg_size_pretty(coalesce(sum(bytes),0)::bigint) AS logical_bytes_reclaimed
FROM removed;

-- PostgreSQL may reuse the pages but ext4 "df" won't immediately shrink.
-- VACUUM FULL takes an exclusive lock and needs a separately approved
-- downtime/space plan. Never run it as part of this batch cleanup.
