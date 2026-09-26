CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"field_clocks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "areas_version_positive" CHECK ("areas"."version">0)
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"field_clocks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "milestones_version_positive" CHECK ("milestones"."version">0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"field_clocks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "projects_version_positive" CHECK ("projects"."version">0)
);
--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"field_clocks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "saved_filters_version_positive" CHECK ("saved_filters"."version">0)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"field_clocks" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "tasks_version_positive" CHECK ("tasks"."version">0)
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "work_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "areas_user_updated" ON "areas" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "areas_user_deleted" ON "areas" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "milestones_user_updated" ON "milestones" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "milestones_user_deleted" ON "milestones" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "projects_user_updated" ON "projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "projects_user_deleted" ON "projects" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "saved_filters_user_updated" ON "saved_filters" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "saved_filters_user_deleted" ON "saved_filters" USING btree ("user_id","deleted_at");--> statement-breakpoint
CREATE INDEX "tasks_user_updated" ON "tasks" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "tasks_user_deleted" ON "tasks" USING btree ("user_id","deleted_at");
--> statement-breakpoint
CREATE INDEX tasks_search ON tasks USING gin (to_tsvector('simple', coalesce(data->>'title','') || ' ' || coalesce(data->>'notes','')));
--> statement-breakpoint
CREATE INDEX tasks_user_due ON tasks (user_id, (data->>'dueDate'));
--> statement-breakpoint
CREATE INDEX tasks_user_project ON tasks (user_id, (data->>'projectId'));
--> statement-breakpoint
CREATE INDEX tasks_user_parent ON tasks (user_id, (data->>'parentId'));
--> statement-breakpoint
CREATE INDEX tasks_user_status ON tasks (user_id, (data->>'status'));
--> statement-breakpoint
CREATE INDEX projects_user_status ON projects (user_id, (data->>'status'));
