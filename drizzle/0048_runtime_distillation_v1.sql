CREATE TABLE "runtime_distillation_watermarks" (
  "user_id" uuid NOT NULL,
  "subject_id" text NOT NULL,
  "conversation_id" uuid NOT NULL,
  "last_source_message_id" uuid NOT NULL,
  "process_version" varchar(64) NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runtime_distillation_watermarks_pk" PRIMARY KEY("user_id","subject_id","conversation_id"),
  CONSTRAINT "runtime_distillation_watermarks_subject_not_blank" CHECK (char_length(btrim("subject_id")) > 0),
  CONSTRAINT "runtime_distillation_watermarks_process_not_blank" CHECK (char_length(btrim("process_version")) > 0)
);
ALTER TABLE "runtime_distillation_watermarks" ADD CONSTRAINT "runtime_distillation_watermarks_conversation_user_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."conversations"("id","user_id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "runtime_distillation_watermarks" ADD CONSTRAINT "runtime_distillation_watermarks_message_conversation_user_fk" FOREIGN KEY ("last_source_message_id","conversation_id","user_id") REFERENCES "public"."conversation_messages"("id","conversation_id","user_id") ON DELETE cascade ON UPDATE cascade;
