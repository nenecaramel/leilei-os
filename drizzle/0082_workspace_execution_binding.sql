ALTER TABLE "conversation_provider_session_checkpoints" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation_provider_session_checkpoints" ADD COLUMN "effective_workspace_root" text;--> statement-breakpoint
ALTER TABLE "native_live_provider_session_cleanups" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "native_live_provider_session_cleanups" ADD COLUMN "effective_workspace_root" text;--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD COLUMN "expected_workspace_root" text;--> statement-breakpoint
CREATE INDEX "conversation_provider_session_checkpoints_workspace_idx" ON "conversation_provider_session_checkpoints" USING btree ("user_id","workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "native_live_provider_session_cleanups_workspace_idx" ON "native_live_provider_session_cleanups" USING btree ("user_id","workspace_id","created_at","id");--> statement-breakpoint
ALTER TABLE "conversation_provider_session_checkpoints" ADD CONSTRAINT "conversation_provider_session_checkpoints_workspace_root_not_blank" CHECK ("conversation_provider_session_checkpoints"."effective_workspace_root" IS NULL OR char_length(btrim("conversation_provider_session_checkpoints"."effective_workspace_root")) > 0);--> statement-breakpoint
ALTER TABLE "native_live_provider_session_cleanups" ADD CONSTRAINT "native_live_provider_session_cleanups_workspace_root_not_blank" CHECK ("native_live_provider_session_cleanups"."effective_workspace_root" IS NULL OR char_length(btrim("native_live_provider_session_cleanups"."effective_workspace_root")) > 0);--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_workspace_root_not_blank" CHECK ("native_live_turn_preparations"."expected_workspace_root" IS NULL OR char_length(btrim("native_live_turn_preparations"."expected_workspace_root")) > 0);
