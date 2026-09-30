CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"field_clocks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "calendar_events_version_positive" CHECK ("calendar_events"."version">0)
);
--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_user_updated" ON "calendar_events" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "calendar_events_user_deleted" ON "calendar_events" USING btree ("user_id","deleted_at");