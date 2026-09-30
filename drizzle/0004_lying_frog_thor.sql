CREATE TABLE "calendar_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"refresh_cipher" text,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"state_hash" text,
	"verifier_cipher" text,
	"state_expires" timestamp with time zone,
	CONSTRAINT "calendar_connections_version_positive" CHECK ("calendar_connections"."version">0)
);
--> statement-breakpoint
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_connections_user" ON "calendar_connections" USING btree ("user_id");