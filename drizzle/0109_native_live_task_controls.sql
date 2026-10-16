ALTER TABLE "native_live_runtime_controls" DROP CONSTRAINT "native_live_runtime_controls_kind_allowed";
--> statement-breakpoint
ALTER TABLE "native_live_runtime_controls" ADD CONSTRAINT "native_live_runtime_controls_kind_allowed" CHECK ("kind" IN ('mid_turn_input', 'interrupt', 'task'));
