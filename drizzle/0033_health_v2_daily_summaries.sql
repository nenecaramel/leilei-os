CREATE TABLE "health_daily_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"steps" integer NOT NULL,
	"menstruating" boolean NOT NULL,
	"period_start_date" date,
	"cycle_day" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_daily_summaries_steps_nonnegative" CHECK ("health_daily_summaries"."steps" >= 0),
	CONSTRAINT "health_daily_summaries_cycle_day_positive" CHECK ("health_daily_summaries"."cycle_day" IS NULL OR "health_daily_summaries"."cycle_day" >= 1),
	CONSTRAINT "health_daily_summaries_cycle_pair" CHECK (("health_daily_summaries"."period_start_date" IS NULL) = ("health_daily_summaries"."cycle_day" IS NULL)),
	CONSTRAINT "health_daily_summaries_period_not_future" CHECK ("health_daily_summaries"."period_start_date" IS NULL OR "health_daily_summaries"."period_start_date" <= "health_daily_summaries"."date"),
	CONSTRAINT "health_daily_summaries_cycle_consistent" CHECK ("health_daily_summaries"."period_start_date" IS NULL OR "health_daily_summaries"."cycle_day" = ("health_daily_summaries"."date" - "health_daily_summaries"."period_start_date") + 1)
);
--> statement-breakpoint
ALTER TABLE "health_daily_summaries" ADD CONSTRAINT "health_daily_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "health_daily_summaries_user_date_uidx" ON "health_daily_summaries" USING btree ("user_id","date");