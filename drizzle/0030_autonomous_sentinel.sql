CREATE TABLE "sentinel_wake_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sentinel_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"control_revision" integer NOT NULL,
	"cause" varchar(32) NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bridge_event_id" uuid NOT NULL,
	"state" varchar(32) DEFAULT 'bridge_enqueued' NOT NULL,
	"decision" varchar(16),
	"next_wake_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"failure_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sentinel_wake_runs_control_revision_nonnegative" CHECK ("sentinel_wake_runs"."control_revision" >= 0),
	CONSTRAINT "sentinel_wake_runs_cause_allowed" CHECK ("sentinel_wake_runs"."cause" IN ('scheduled', 'wake_now', 'recovery')),
	CONSTRAINT "sentinel_wake_runs_state_allowed" CHECK ("sentinel_wake_runs"."state" IN ('bridge_enqueued', 'claimed', 'finalized', 'superseded', 'recovery_required')),
	CONSTRAINT "sentinel_wake_runs_decision_allowed" CHECK ("sentinel_wake_runs"."decision" IS NULL OR "sentinel_wake_runs"."decision" IN ('contact', 'quiet'))
);
--> statement-breakpoint
CREATE TABLE "sentinels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"policy_prompt" varchar(4000) DEFAULT '' NOT NULL,
	"next_wake_at" timestamp with time zone,
	"last_valid_wake_at" timestamp with time zone,
	"wake_context_capsule" varchar(1024),
	"wake_context_updated_at" timestamp with time zone,
	"control_revision" integer DEFAULT 0 NOT NULL,
	"active_wake_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sentinels_timezone_not_blank" CHECK (char_length(btrim("sentinels"."timezone")) > 0),
	CONSTRAINT "sentinels_policy_prompt_bounds" CHECK (char_length("sentinels"."policy_prompt") <= 4000),
	CONSTRAINT "sentinels_wake_context_capsule_bounds" CHECK ("sentinels"."wake_context_capsule" IS NULL OR char_length("sentinels"."wake_context_capsule") <= 1024),
	CONSTRAINT "sentinels_control_revision_nonnegative" CHECK ("sentinels"."control_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bridge_events" DROP CONSTRAINT "bridge_events_kind_allowed";--> statement-breakpoint
ALTER TABLE "bridge_events" DROP CONSTRAINT "bridge_events_source_allowed";--> statement-breakpoint
ALTER TABLE "bridge_events" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sentinel_wake_runs" ADD CONSTRAINT "sentinel_wake_runs_sentinel_id_sentinels_id_fk" FOREIGN KEY ("sentinel_id") REFERENCES "public"."sentinels"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sentinel_wake_runs" ADD CONSTRAINT "sentinel_wake_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sentinel_wake_runs" ADD CONSTRAINT "sentinel_wake_runs_bridge_event_id_bridge_events_id_fk" FOREIGN KEY ("bridge_event_id") REFERENCES "public"."bridge_events"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sentinels" ADD CONSTRAINT "sentinels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "sentinel_wake_runs_bridge_event_id_uidx" ON "sentinel_wake_runs" USING btree ("bridge_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sentinel_wake_runs_active_sentinel_uidx" ON "sentinel_wake_runs" USING btree ("sentinel_id") WHERE "sentinel_wake_runs"."state" IN ('bridge_enqueued', 'claimed', 'recovery_required');--> statement-breakpoint
CREATE INDEX "sentinel_wake_runs_user_state_created_idx" ON "sentinel_wake_runs" USING btree ("user_id","state","created_at");--> statement-breakpoint
CREATE INDEX "sentinel_wake_runs_sentinel_created_idx" ON "sentinel_wake_runs" USING btree ("sentinel_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sentinels_user_id_uidx" ON "sentinels" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "bridge_events" ADD CONSTRAINT "bridge_events_cancelled_at_allowed" CHECK ("bridge_events"."cancelled_at" IS NULL OR ("bridge_events"."kind" = 'wake' AND "bridge_events"."source" = 'leileios_sentinel' AND "bridge_events"."dispatch_started_at" IS NULL AND "bridge_events"."status" IN ('pending', 'reserved')));--> statement-breakpoint
ALTER TABLE "bridge_events" ADD CONSTRAINT "bridge_events_kind_allowed" CHECK ("bridge_events"."kind" IN ('chat', 'wake'));--> statement-breakpoint
ALTER TABLE "bridge_events" ADD CONSTRAINT "bridge_events_source_allowed" CHECK ("bridge_events"."source" IN ('leileios_pwa', 'leileios_sentinel'));