-- Native Live historically used lifecycle_status='deleted' as a recoverable
-- soft-delete state. The product lifecycle is now Archive / Restore / true
-- Delete. Preserve all existing recoverable rows by migrating them to archive.
UPDATE "conversations"
SET
  "lifecycle_status" = 'archived',
  "archived_at" = COALESCE("deleted_at", "updated_at", now()),
  "deleted_at" = NULL,
  "updated_at" = GREATEST(
    "updated_at",
    COALESCE("deleted_at", "updated_at")
  )
WHERE "origin" = 'native_live'
  AND "lifecycle_status" = 'deleted';
