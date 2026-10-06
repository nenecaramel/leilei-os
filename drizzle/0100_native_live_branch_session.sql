ALTER TABLE "native_live_turn_preparations" ADD COLUMN "parent_provider_checkpoint_id" text;
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" DROP CONSTRAINT "native_live_turn_preparations_runtime_mode_allowed";
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_runtime_mode_allowed" CHECK ("runtime_mode" IN ('new', 'resume', 'fork'));
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" DROP CONSTRAINT "native_live_turn_preparations_runtime_parent_consistency";
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_runtime_parent_consistency" CHECK (("runtime_mode" = 'new' AND "parent_provider_session_id" IS NULL) OR ("runtime_mode" IN ('fork', 'resume') AND "parent_provider_session_id" IS NOT NULL AND char_length(btrim("parent_provider_session_id")) > 0));
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations" ADD CONSTRAINT "native_live_turn_preparations_checkpoint_consistency" CHECK (("runtime_mode" <> 'new' OR "parent_provider_checkpoint_id" IS NULL) AND ("runtime_mode" <> 'resume' OR "parent_provider_checkpoint_id" IS NOT NULL) AND ("parent_provider_checkpoint_id" IS NULL OR "parent_provider_checkpoint_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'));
