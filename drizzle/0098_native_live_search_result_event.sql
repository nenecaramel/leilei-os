ALTER TABLE "native_live_runtime_events"
  DROP CONSTRAINT "native_live_runtime_events_type_allowed";
--> statement-breakpoint
ALTER TABLE "native_live_runtime_events"
  ADD CONSTRAINT "native_live_runtime_events_type_allowed"
  CHECK ("event_type" IN ('session','text','partial_text','tool_use','tool_result','search_result','attachment','task','result','error','runtime'));
