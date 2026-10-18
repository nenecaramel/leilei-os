-- Incremental multilingual E5 semantic candidate index using stock Postgres.
-- No pgvector extension, no separate database and no Mac snapshots.
CREATE TABLE IF NOT EXISTS runtime_mind_recall_semantic_dirty (
  state_id uuid PRIMARY KEY REFERENCES runtime_subject_states(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  subject_id text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  queued_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runtime_mind_recall_semantic_dirty_pending_idx
  ON runtime_mind_recall_semantic_dirty (queued_at, state_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS runtime_mind_recall_semantic_bands (
  state_id uuid NOT NULL REFERENCES runtime_subject_states(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  subject_id text NOT NULL,
  band smallint NOT NULL CHECK (band BETWEEN 0 AND 19),
  bucket integer NOT NULL CHECK (bucket BETWEEN 0 AND 65535),
  content_sha256 char(64) NOT NULL,
  algorithm_version varchar(40) NOT NULL DEFAULT 'e5-small-lsh-v1',
  PRIMARY KEY (state_id, band)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runtime_mind_recall_semantic_buckets_idx
  ON runtime_mind_recall_semantic_bands (user_id, subject_id, algorithm_version, band, bucket, state_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION runtime_mind_recall_mark_semantic_dirty()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
    AND NEW.subject_id IS NOT DISTINCT FROM OLD.subject_id
    AND NEW.kind IS NOT DISTINCT FROM OLD.kind
    AND NEW.text IS NOT DISTINCT FROM OLD.text
    AND NEW.scope_applicability IS NOT DISTINCT FROM OLD.scope_applicability
    AND NEW.settlement_status IS NOT DISTINCT FROM OLD.settlement_status
    AND NEW.path_status IS NOT DISTINCT FROM OLD.path_status
    AND NEW.validity_status IS NOT DISTINCT FROM OLD.validity_status
    AND (NEW.envelope #>> '{scope,visibility}') IS NOT DISTINCT FROM
        (OLD.envelope #>> '{scope,visibility}')
    AND (NEW.envelope #>> '{status,generationStatus}') IS NOT DISTINCT FROM
        (OLD.envelope #>> '{status,generationStatus}')
    AND (NEW.envelope #>> '{status,presentationStatus}') IS NOT DISTINCT FROM
        (OLD.envelope #>> '{status,presentationStatus}')
    AND (NEW.payload #>> '{lifecycle_v1,status}') IS NOT DISTINCT FROM
        (OLD.payload #>> '{lifecycle_v1,status}')
  THEN
    RETURN NEW;
  END IF;
  -- Invalidate old vector buckets in the same transaction as any edit,
  -- privacy transition or deletion; never leave hidden Memory searchable.
  DELETE FROM runtime_mind_recall_semantic_bands WHERE state_id = NEW.id;
  IF NEW.kind = 'memory'
    AND NEW.scope_applicability = 'global'
    AND NEW.settlement_status = 'settled'
    AND NEW.path_status = 'current'
    AND NEW.validity_status = 'valid'
    AND NEW.envelope #>> '{scope,visibility}' IS DISTINCT FROM 'hidden_system'
    AND NEW.envelope #>> '{status,generationStatus}' = 'committed'
    AND NEW.envelope #>> '{status,presentationStatus}' = 'presented'
    AND NEW.payload #>> '{lifecycle_v1,status}' IS DISTINCT FROM 'forgotten'
    AND NEW.text IS NOT NULL AND length(btrim(NEW.text)) > 0
  THEN
    INSERT INTO runtime_mind_recall_semantic_dirty
      (state_id, user_id, subject_id, revision, claimed_at)
    VALUES (NEW.id, NEW.user_id, NEW.subject_id, 1, NULL)
    ON CONFLICT (state_id) DO UPDATE SET
      revision = runtime_mind_recall_semantic_dirty.revision + 1,
      queued_at = now(), claimed_at = NULL;
    PERFORM pg_notify('leilei_mind_semantic_dirty', '');
  ELSE
    DELETE FROM runtime_mind_recall_semantic_dirty WHERE state_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS runtime_mind_recall_semantic_dirty_trigger ON runtime_subject_states;
--> statement-breakpoint
CREATE TRIGGER runtime_mind_recall_semantic_dirty_trigger
AFTER INSERT OR UPDATE OF user_id, subject_id, kind, text, scope_applicability, settlement_status,
  path_status, validity_status, envelope, payload
ON runtime_subject_states FOR EACH ROW
EXECUTE FUNCTION runtime_mind_recall_mark_semantic_dirty();
--> statement-breakpoint
-- Existing memories are queued once; a Railway-side worker processes the
-- finite backlog asynchronously and every subsequent change by NOTIFY.
INSERT INTO runtime_mind_recall_semantic_dirty (state_id, user_id, subject_id)
SELECT id, user_id, subject_id FROM runtime_subject_states
WHERE kind = 'memory' AND scope_applicability = 'global'
  AND settlement_status = 'settled' AND path_status = 'current'
  AND validity_status = 'valid'
  AND envelope #>> '{scope,visibility}' IS DISTINCT FROM 'hidden_system'
  AND envelope #>> '{status,generationStatus}' = 'committed'
  AND envelope #>> '{status,presentationStatus}' = 'presented'
  AND payload #>> '{lifecycle_v1,status}' IS DISTINCT FROM 'forgotten'
  AND text IS NOT NULL AND length(btrim(text)) > 0
ON CONFLICT (state_id) DO NOTHING;
