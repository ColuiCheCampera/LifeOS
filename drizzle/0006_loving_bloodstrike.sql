CREATE TABLE "calendar_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"source_id" uuid NOT NULL,
	"connection_version" integer NOT NULL,
	"token_hash" text NOT NULL,
	"resource_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_message" text DEFAULT '0' NOT NULL,
	CONSTRAINT "calendar_channels_version_positive" CHECK ("calendar_channels"."version">0)
);
--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD COLUMN "watch_next_run" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD COLUMN "watch_error" text;--> statement-breakpoint
ALTER TABLE "calendar_sources" ADD COLUMN "notification_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_channels" ADD CONSTRAINT "calendar_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_channels" ADD CONSTRAINT "calendar_channels_source_id_calendar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."calendar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_channels_source" ON "calendar_channels" USING btree ("user_id","source_id");--> statement-breakpoint
CREATE INDEX "calendar_channels_expiration" ON "calendar_channels" USING btree ("status","expires_at");