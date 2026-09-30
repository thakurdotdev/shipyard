CREATE TABLE "uptime_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"status" varchar(20) NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "uptime_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"checked_at" timestamp DEFAULT now() NOT NULL,
	"success" boolean NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "uptime_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"endpoint_url" text,
	"interval_seconds" integer DEFAULT 300 NOT NULL,
	"timeout_seconds" integer DEFAULT 10 NOT NULL,
	"current_status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp,
	"next_check_at" timestamp,
	"down_since" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uptime_monitors_project_id_unique" UNIQUE("project_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "uptime_alerts" ADD CONSTRAINT "uptime_alerts_monitor_id_uptime_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."uptime_monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_checks" ADD CONSTRAINT "uptime_checks_monitor_id_uptime_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."uptime_monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uptime_monitors" ADD CONSTRAINT "uptime_monitors_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uptime_checks_monitor_checked_idx" ON "uptime_checks" USING btree ("monitor_id","checked_at");--> statement-breakpoint
CREATE INDEX "uptime_monitors_due_idx" ON "uptime_monitors" USING btree ("enabled","next_check_at");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE "projects" SET "owner_id" = (SELECT min("id") FROM "user") WHERE "owner_id" IS NULL AND (SELECT count(*) FROM "user") = 1;
--> statement-breakpoint
INSERT INTO "uptime_monitors" ("project_id") SELECT "id" FROM "projects" ON CONFLICT ("project_id") DO NOTHING;
