CREATE TABLE "native_live_session_owners" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"owner" varchar(16) DEFAULT 'leileios' NOT NULL,
	"owner_revision" text,
	"writer_generation" uuid NOT NULL,
	"turn_prepare_id" uuid,
	"turn_anchor_message_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "native_live_session_owners_owner_allowed" CHECK ("owner" IN ('leileios','releasing','desktop')),
	CONSTRAINT "native_live_session_owners_anchor_needs_turn" CHECK ("turn_anchor_message_id" IS NULL OR "turn_prepare_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "native_live_session_owners" ADD CONSTRAINT "native_live_session_owners_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
-- Shadow backfill. The writer generation starts as the current presentation
-- owner, so checkpoint stamps that are valid today stay valid.
INSERT INTO "native_live_session_owners"
  ("conversation_id","user_id","owner","owner_revision","writer_generation","turn_prepare_id","turn_anchor_message_id")
SELECT c.id, c.user_id,
  CASE WHEN c.provider_metadata->'nativeSessionSource'->>'owner' = 'desktop' THEN 'desktop' ELSE 'leileios' END,
  c.provider_metadata->'nativeSessionSource'->>'revision',
  CASE WHEN c.provider_metadata->'native_live_presentation_owner'->>'prepareId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (c.provider_metadata->'native_live_presentation_owner'->>'prepareId')::uuid ELSE gen_random_uuid() END,
  CASE WHEN c.provider_metadata->'native_live_presentation_owner'->>'prepareId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (c.provider_metadata->'native_live_presentation_owner'->>'prepareId')::uuid END,
  CASE WHEN c.provider_metadata->'native_live_presentation_owner'->>'prepareId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND c.provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (c.provider_metadata->'native_live_presentation_owner'->>'anchorHeadMessageId')::uuid END
FROM "conversations" c
WHERE c.origin = 'native_live';
