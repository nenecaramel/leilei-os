-- Code stopped touching these tables in the release before this one. They are
-- dropped only while all of them are empty: one row anywhere stops the whole
-- migration, and nothing is dropped. The migration log prints only the SQLSTATE,
-- so LE011–LE014 name the table, in this order. No CASCADE.
SET LOCAL lock_timeout = '10s';--> statement-breakpoint
LOCK TABLE "public"."conversation_favorites", "public"."native_live_background_model_jobs", "public"."runtime_effects", "public"."runtime_proactivity_wakes" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."conversation_favorites") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: conversation_favorites' USING ERRCODE = 'LE011';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."native_live_background_model_jobs") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: native_live_background_model_jobs' USING ERRCODE = 'LE012';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."runtime_effects") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: runtime_effects' USING ERRCODE = 'LE013';
  END IF;
  IF EXISTS (SELECT 1 FROM "public"."runtime_proactivity_wakes") THEN
    RAISE EXCEPTION 'UNUSED_TABLE_NOT_EMPTY: runtime_proactivity_wakes' USING ERRCODE = 'LE014';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "public"."conversation_favorites";--> statement-breakpoint
DROP TABLE "public"."native_live_background_model_jobs";--> statement-breakpoint
DROP TABLE "public"."runtime_effects";--> statement-breakpoint
DROP TABLE "public"."runtime_proactivity_wakes";
