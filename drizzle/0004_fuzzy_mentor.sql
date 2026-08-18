CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"accent_color" varchar(7) DEFAULT '#405f4d' NOT NULL,
	"home_title" varchar(120),
	"home_subtitle" varchar(240),
	"preferred_name" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_accent_color_format" CHECK ("user_settings"."accent_color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "user_settings_home_title_not_blank" CHECK ("user_settings"."home_title" IS NULL OR char_length(btrim("user_settings"."home_title")) > 0),
	CONSTRAINT "user_settings_home_subtitle_not_blank" CHECK ("user_settings"."home_subtitle" IS NULL OR char_length(btrim("user_settings"."home_subtitle")) > 0),
	CONSTRAINT "user_settings_preferred_name_not_blank" CHECK ("user_settings"."preferred_name" IS NULL OR char_length(btrim("user_settings"."preferred_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_user_unique_idx" ON "user_settings" USING btree ("user_id");