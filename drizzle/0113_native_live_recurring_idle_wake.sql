ALTER TABLE "native_live_silence_wake_receipts" DROP CONSTRAINT "native_live_silence_wake_receipts_slot_allowed";
--> statement-breakpoint
ALTER TABLE "native_live_silence_wake_receipts" ADD CONSTRAINT "native_live_silence_wake_receipts_slot_allowed" CHECK ("slot" IN ('post_turn_idle', 'mid_idle', 'long_idle', 'concern_1', 'concern_2', 'concern_3') OR "slot" ~ '^idle_([1-9]|[1-5][0-9]|6[0-4])$');
