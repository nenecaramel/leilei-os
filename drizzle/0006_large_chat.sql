CREATE TYPE "public"."toy_command_action" AS ENUM('set', 'stop');--> statement-breakpoint
CREATE TYPE "public"."toy_command_status" AS ENUM('pending', 'claimed', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "toy_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "toy_command_action" NOT NULL,
	"percent" integer,
	"status" "toy_command_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"error" varchar(500),
	CONSTRAINT "toy_commands_action_allowed" CHECK ("toy_commands"."action" IN ('set', 'stop')),
	CONSTRAINT "toy_commands_status_allowed" CHECK ("toy_commands"."status" IN ('pending', 'claimed', 'completed', 'failed', 'expired')),
	CONSTRAINT "toy_commands_action_percent_consistency" CHECK (("toy_commands"."action" = 'set' AND "toy_commands"."percent" IS NOT NULL AND "toy_commands"."percent" BETWEEN 1 AND 40) OR ("toy_commands"."action" = 'stop' AND "toy_commands"."percent" IS NULL)),
	CONSTRAINT "toy_commands_error_length" CHECK ("toy_commands"."error" IS NULL OR char_length("toy_commands"."error") <= 500),
	CONSTRAINT "toy_commands_expiry_after_creation" CHECK ("toy_commands"."expires_at" > "toy_commands"."created_at")
);
--> statement-breakpoint
ALTER TABLE "toy_commands" ADD CONSTRAINT "toy_commands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "toy_commands_claim_queue_idx" ON "toy_commands" USING btree ("user_id","status","expires_at","action","created_at","id");
