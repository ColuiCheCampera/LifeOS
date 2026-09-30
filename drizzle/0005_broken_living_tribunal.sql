CREATE TABLE "calendar_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"source_id" uuid NOT NULL,
	"event_id" uuid,
	"remote_id" text NOT NULL,
	"etag" text,
	"base" jsonb,
	"remote" jsonb,
	"state" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"remote_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"timezone" text NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sync_token" text,
	"next_run" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "calendar_bindings" ADD CONSTRAINT "calendar_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_bindings" ADD CONSTRAINT "calendar_bindings_source_id_calendar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_bindings" ADD CONSTRAINT "calendar_bindings_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD CONSTRAINT "calendar_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_bindings_remote" ON "calendar_bindings" USING btree ("user_id","source_id","remote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_bindings_event" ON "calendar_bindings" USING btree ("user_id","event_id");--> statement-breakpoint
CREATE INDEX "calendar_bindings_source" ON "calendar_bindings" USING btree ("user_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_sources_user_remote" ON "calendar_sources" USING btree ("user_id","remote_id");--> statement-breakpoint
CREATE INDEX "calendar_sources_due" ON "calendar_sources" USING btree ("enabled","next_run");