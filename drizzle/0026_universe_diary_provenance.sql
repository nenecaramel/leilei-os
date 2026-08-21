CREATE TABLE "universe_diary_sources" (
	"user_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"diary_id" uuid NOT NULL,
	CONSTRAINT "universe_diary_sources_user_id_node_id_diary_id_pk" PRIMARY KEY("user_id","node_id","diary_id")
);
--> statement-breakpoint
ALTER TABLE "universe_diary_sources" ADD CONSTRAINT "universe_diary_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "universe_diary_sources" ADD CONSTRAINT "universe_diary_sources_node_fk" FOREIGN KEY ("user_id","node_id") REFERENCES "public"."universe_nodes"("user_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "universe_diary_sources" ADD CONSTRAINT "universe_diary_sources_diary_fk" FOREIGN KEY ("user_id","diary_id") REFERENCES "public"."diary_entries"("user_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "diary_entries_user_id_id_uidx" ON "diary_entries" USING btree ("user_id","id");