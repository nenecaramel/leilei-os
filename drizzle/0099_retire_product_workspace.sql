-- Namespace retirement is atomic. Block concurrent appends/status writes while
-- checking both tables, including collisions split between entries and status.
LOCK TABLE "native_live_provider_session_entries", "native_live_provider_session_store_status" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (
      SELECT user_id, provider_session_id, workspace_id FROM native_live_provider_session_entries
      UNION
      SELECT user_id, provider_session_id, workspace_id FROM native_live_provider_session_store_status
    ) namespaces
    GROUP BY user_id, provider_session_id
    HAVING count(DISTINCT workspace_id) > 1
  ) THEN
    RAISE EXCEPTION 'SESSION_STORE_NAMESPACE_COLLISION: one user/provider session has multiple historical namespaces';
  END IF;
END $$;--> statement-breakpoint
DROP INDEX IF EXISTS "native_live_provider_session_entries_load_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "native_live_provider_session_entries_sessions_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "native_live_provider_session_entries_batch_ordinal_uidx";--> statement-breakpoint
ALTER TABLE "native_live_provider_session_store_status" DROP CONSTRAINT "native_live_provider_session_store_status_pk";--> statement-breakpoint
ALTER TABLE "native_live_provider_session_entries" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "native_live_provider_session_store_status" DROP COLUMN "workspace_id";--> statement-breakpoint
CREATE INDEX "native_live_provider_session_entries_load_idx" ON "native_live_provider_session_entries" ("user_id","provider_session_id","subpath","id");--> statement-breakpoint
CREATE INDEX "native_live_provider_session_entries_sessions_idx" ON "native_live_provider_session_entries" ("user_id","subpath","created_at" DESC,"provider_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "native_live_provider_session_entries_batch_ordinal_uidx" ON "native_live_provider_session_entries" ("user_id","provider_session_id","subpath","append_batch_id","append_ordinal");--> statement-breakpoint
ALTER TABLE "native_live_provider_session_store_status" ADD CONSTRAINT "native_live_provider_session_store_status_pk" PRIMARY KEY ("user_id","provider_session_id");--> statement-breakpoint
DROP INDEX IF EXISTS "conversation_provider_session_checkpoints_workspace_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "native_live_provider_session_cleanups_workspace_idx";--> statement-breakpoint
ALTER TABLE "conversation_provider_session_checkpoints" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "native_live_provider_session_cleanups" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "native_live_conversation_provider_bootstraps" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "conversation_provider_session_checkpoints" RENAME COLUMN "effective_workspace_root" TO "effective_working_directory";--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" RENAME COLUMN "expected_workspace_root" TO "expected_working_directory";--> statement-breakpoint
ALTER TABLE "native_live_provider_session_cleanups" RENAME COLUMN "effective_workspace_root" TO "effective_working_directory";--> statement-breakpoint
ALTER TABLE "native_live_conversation_provider_bootstraps" RENAME COLUMN "effective_workspace_root" TO "effective_working_directory";--> statement-breakpoint
ALTER TABLE "conversation_provider_session_checkpoints" DROP CONSTRAINT IF EXISTS "conversation_provider_session_checkpoints_workspace_root_not_blank";--> statement-breakpoint
ALTER TABLE "conversation_provider_session_checkpoints" ADD CONSTRAINT "conversation_provider_checkpoints_directory_not_blank" CHECK ("effective_working_directory" IS NULL OR char_length(btrim("effective_working_directory")) > 0);--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" DROP CONSTRAINT IF EXISTS "native_live_turn_preparations_workspace_root_not_blank";--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_working_directory_not_blank" CHECK ("expected_working_directory" IS NULL OR char_length(btrim("expected_working_directory")) > 0);--> statement-breakpoint
ALTER TABLE "native_live_provider_session_cleanups" DROP CONSTRAINT IF EXISTS "native_live_provider_session_cleanups_workspace_root_not_blank";--> statement-breakpoint
ALTER TABLE "native_live_provider_session_cleanups" ADD CONSTRAINT "native_live_provider_cleanups_directory_not_blank" CHECK ("effective_working_directory" IS NULL OR char_length(btrim("effective_working_directory")) > 0);--> statement-breakpoint
ALTER TABLE "native_live_manual_compactions" DROP COLUMN "workspace_id";--> statement-breakpoint
ALTER TABLE "native_live_manual_compactions" RENAME COLUMN "effective_workspace_root" TO "effective_working_directory";--> statement-breakpoint
ALTER TABLE "native_live_manual_compactions" DROP CONSTRAINT IF EXISTS "native_live_manual_compactions_workspace_root_not_blank";--> statement-breakpoint
ALTER TABLE "native_live_manual_compactions" ADD CONSTRAINT "native_live_manual_compactions_working_directory_not_blank" CHECK ("effective_working_directory" IS NULL OR char_length(btrim("effective_working_directory")) > 0);--> statement-breakpoint
-- Product data is intentionally retired; provider transcripts and directory
-- evidence above are preserved in place. Do not cascade into canonical data.
DROP TABLE "workspace_conversations";--> statement-breakpoint
DROP TABLE "workspace_resources";--> statement-breakpoint
DROP TABLE "workspaces";

--> statement-breakpoint
DELETE FROM "product_create_idempotency" WHERE "operation" IN ('workspace_create','workspace_resource_create');--> statement-breakpoint
ALTER TABLE "product_create_idempotency" DROP CONSTRAINT IF EXISTS "product_create_idempotency_operation_allowed";--> statement-breakpoint
ALTER TABLE "product_create_idempotency" ADD CONSTRAINT "product_create_idempotency_operation_allowed" CHECK ("operation" IN ('mind_manual_create'));--> statement-breakpoint
ALTER TABLE "product_create_idempotency" DROP CONSTRAINT IF EXISTS "product_create_idempotency_resource_type_allowed";--> statement-breakpoint
ALTER TABLE "product_create_idempotency" ADD CONSTRAINT "product_create_idempotency_resource_type_allowed" CHECK ("resource_type" IN ('mind_state'));
