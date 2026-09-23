ALTER TABLE "runtime_effects"
  ADD CONSTRAINT "runtime_effects_id_user_unique"
  UNIQUE ("id","user_id");
--> statement-breakpoint
CREATE TABLE "runtime_effect_message_deliveries" (
  "effect_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "message_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runtime_effect_message_deliveries"
  ADD CONSTRAINT "runtime_effect_message_deliveries_effect_user_fk"
  FOREIGN KEY ("effect_id","user_id")
  REFERENCES "public"."runtime_effects"("id","user_id")
  ON DELETE cascade
  ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "runtime_effect_message_deliveries"
  ADD CONSTRAINT "runtime_effect_message_deliveries_conversation_user_fk"
  FOREIGN KEY ("conversation_id","user_id")
  REFERENCES "public"."conversations"("id","user_id")
  ON DELETE cascade
  ON UPDATE cascade;
--> statement-breakpoint
ALTER TABLE "runtime_effect_message_deliveries"
  ADD CONSTRAINT "runtime_effect_message_deliveries_message_conversation_user_fk"
  FOREIGN KEY ("message_id","conversation_id","user_id")
  REFERENCES "public"."conversation_messages"("id","conversation_id","user_id")
  ON DELETE cascade
  ON UPDATE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_effect_message_deliveries_message_uidx"
  ON "runtime_effect_message_deliveries"
  USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "runtime_effect_message_deliveries_user_created_idx"
  ON "runtime_effect_message_deliveries"
  USING btree ("user_id","created_at","effect_id");
