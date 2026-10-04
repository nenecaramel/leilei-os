ALTER TABLE "native_live_turn_preparations"
  ALTER COLUMN "canonical_user_message_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations"
  ADD COLUMN "wake_context" jsonb;
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations"
  DROP CONSTRAINT "native_live_turn_preparations_operation_allowed";
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations"
  ADD CONSTRAINT "native_live_turn_preparations_operation_allowed"
  CHECK ("operation" IN ('send', 'retry', 'edit', 'wake'));
--> statement-breakpoint
ALTER TABLE "native_live_turn_preparations"
  ADD CONSTRAINT "native_live_turn_preparations_wake_consistency"
  CHECK (
    (
      "operation" = 'wake'
      AND "canonical_user_message_id" IS NULL
      AND "replacement_target_user_message_id" IS NULL
      AND "wake_context" IS NOT NULL
      AND jsonb_typeof("wake_context") = 'object'
    )
    OR
    (
      "operation" <> 'wake'
      AND "canonical_user_message_id" IS NOT NULL
      AND "wake_context" IS NULL
    )
  );
--> statement-breakpoint
CREATE TABLE "native_live_silence_wake_receipts" (
  "user_id" uuid NOT NULL,
  "epoch_id" uuid NOT NULL,
  "slot" varchar(32) NOT NULL,
  "consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "native_live_silence_wake_receipts_user_epoch_slot_pk"
    PRIMARY KEY ("user_id", "epoch_id", "slot"),
  CONSTRAINT "native_live_silence_wake_receipts_slot_allowed"
    CHECK ("slot" IN ('post_turn_idle', 'long_idle'))
);
