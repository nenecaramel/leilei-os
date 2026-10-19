CREATE TABLE "native_live_concerns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"origin_message_id" uuid NOT NULL,
	"content" varchar(300) NOT NULL,
	"reason" varchar(300),
	"progress" varchar(300),
	"consider_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"release_reason" varchar(16),
	"revision" integer DEFAULT 1 NOT NULL,
	"wake_count" integer DEFAULT 0 NOT NULL,
	"last_woken_at" timestamp with time zone,
	"woken_consider_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "native_live_concerns_status_allowed" CHECK ("status" IN ('active', 'released')),
	CONSTRAINT "native_live_concerns_release_consistency" CHECK ((
        "status" = 'active'
        AND "release_reason" IS NULL
        AND "released_at" IS NULL
      ) OR (
        "status" = 'released'
        AND "release_reason" IN ('resolved', 'dropped')
        AND "released_at" IS NOT NULL
      )),
	CONSTRAINT "native_live_concerns_text_not_blank" CHECK (char_length(btrim("content")) > 0),
	CONSTRAINT "native_live_concerns_window_ordered" CHECK ("consider_at" < "expires_at"),
	CONSTRAINT "native_live_concerns_counters_valid" CHECK ("revision" >= 1 AND "wake_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "native_live_concerns" ADD CONSTRAINT "native_live_concerns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "native_live_concerns" ADD CONSTRAINT "native_live_concerns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE cascade;
--> statement-breakpoint
CREATE INDEX "native_live_concerns_user_status_consider_idx" ON "native_live_concerns" USING btree ("user_id","status","consider_at");
--> statement-breakpoint
CREATE INDEX "native_live_concerns_conversation_idx" ON "native_live_concerns" USING btree ("conversation_id");
--> statement-breakpoint
ALTER TABLE "native_live_silence_wake_receipts" DROP CONSTRAINT "native_live_silence_wake_receipts_slot_allowed";
--> statement-breakpoint
ALTER TABLE "native_live_silence_wake_receipts" ADD CONSTRAINT "native_live_silence_wake_receipts_slot_allowed" CHECK ("slot" IN ('post_turn_idle', 'long_idle', 'concern_1', 'concern_2', 'concern_3'));
