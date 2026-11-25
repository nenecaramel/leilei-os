-- Nothing in the code reads or writes these tables. They are dropped only while
-- all of them are empty: one row anywhere stops the whole migration, and nothing
-- is dropped. The migration log prints only the SQLSTATE, so LE001–LE008 name
-- the table, in this order. No CASCADE.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
LOCK TABLE "public"."conversation_deleted_branches", "public"."conversation_exclusions", "public"."conversation_favorite_messages", "public"."conversation_import_blobs", "public"."conversation_message_versions", "public"."native_live_concerns", "public"."runtime_effect_message_deliveries", "public"."runtime_mind_retirement_receipts" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."conversation_deleted_branches") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: conversation_deleted_branches' USING ERRCODE = 'LE001';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."conversation_exclusions") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: conversation_exclusions' USING ERRCODE = 'LE002';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."conversation_favorite_messages") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: conversation_favorite_messages' USING ERRCODE = 'LE003';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."conversation_import_blobs") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: conversation_import_blobs' USING ERRCODE = 'LE004';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."conversation_message_versions") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: conversation_message_versions' USING ERRCODE = 'LE005';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."native_live_concerns") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: native_live_concerns' USING ERRCODE = 'LE006';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."runtime_effect_message_deliveries") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: runtime_effect_message_deliveries' USING ERRCODE = 'LE007';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."runtime_mind_retirement_receipts") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: runtime_mind_retirement_receipts' USING ERRCODE = 'LE008';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "public"."conversation_deleted_branches";--> statement-breakpoint
DROP TABLE "public"."conversation_exclusions";--> statement-breakpoint
DROP TABLE "public"."conversation_favorite_messages";--> statement-breakpoint
DROP TABLE "public"."conversation_import_blobs";--> statement-breakpoint
DROP TABLE "public"."conversation_message_versions";--> statement-breakpoint
DROP TABLE "public"."native_live_concerns";--> statement-breakpoint
DROP TABLE "public"."runtime_effect_message_deliveries";--> statement-breakpoint
DROP TABLE "public"."runtime_mind_retirement_receipts";
