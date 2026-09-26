ALTER TABLE "native_live_turn_preparations"
ADD COLUMN "replacement_target_user_message_id" uuid;

UPDATE "native_live_turn_preparations"
SET "replacement_target_user_message_id" = "canonical_user_message_id"
WHERE "operation" = 'retry'
  AND "replacement_target_user_message_id" IS NULL;
