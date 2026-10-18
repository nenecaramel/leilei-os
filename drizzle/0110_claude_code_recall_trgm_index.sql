-- One PostgreSQL-managed trigram index for Claude Code candidate discovery.
-- Updated automatically on Memory INSERT/UPDATE/DELETE. No extra worker.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runtime_subject_states_recall_trgm_idx
  ON runtime_subject_states USING gin (text gin_trgm_ops);
