-- DELIBERATELY DISABLED. This file does not delete any data.
-- The earlier generic "reclaim active continuation assets" logic was
-- insufficiently scoped. Never run an unrestricted delete here.
-- Before generating a transaction with DELETE statements, require:
--   1. the exact audit-report allowlist: user_id + session_id + subpath,
--      expected row counts and size, plus conversation_id for snapshots;
--   2. an encrypted PostgreSQL backup with a successful temporary restore;
--   3. old complete-history read and write paths retired in the deployed app;
--   4. producer quiescence, recovery-outbox and dependent-session checks;
--   5. explicit approval of the exact allowlist.
-- Preserve all native status rows and preserve_external_session=true; if
-- the main transcript replica is removed, set store status INCOMPLETE in
-- the same transaction. Never delete any local Mac file.
DO $$
BEGIN
  RAISE EXCEPTION 'Refused: exact scoped allowlist, verified backup and legacy-route retirement required';
END $$;
