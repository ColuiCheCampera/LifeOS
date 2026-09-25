CREATE TABLE "mutation_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"mutation_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "receipts_version_positive" CHECK ("mutation_receipts"."version">0)
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "field_clocks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_user_mutation" ON "mutation_receipts" USING btree ("user_id","mutation_id");--> statement-breakpoint
CREATE INDEX "receipts_user_created" ON "mutation_receipts" USING btree ("user_id","created_at");