-- Read-only Claude Code candidate discovery. PostgreSQL maintains these indexes
-- automatically on INSERT/UPDATE/DELETE; no Mac polling or separate index jobs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runtime_subject_states_recall_trgm_idx
  ON runtime_subject_states USING gin (text gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runtime_subject_states_recall_fts_idx
  ON runtime_subject_states USING gin (to_tsvector('simple', coalesce(text, '')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runtime_subject_states_recall_scope_recent_idx
  ON runtime_subject_states
  (user_id, subject_id, scope_applicability, kind,
   settlement_status, path_status, validity_status, created_at DESC, id);
