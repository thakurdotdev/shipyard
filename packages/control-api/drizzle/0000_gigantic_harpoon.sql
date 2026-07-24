CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"build_id" uuid NOT NULL,
	"level" varchar(20) NOT NULL,
	"message" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" varchar(50) NOT NULL,
	"commit_sha" text,
	"commit_message" text,
	"logs" text,
	"artifact_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"status" varchar(50) NOT NULL,
	"activated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_id" text NOT NULL,
	"account_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_github_installation_id_unique" UNIQUE("github_installation_id")
);
--> statement-breakpoint
CREATE TABLE "infrastructure_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"service_type" varchar(20) NOT NULL,
	"container_id" text,
	"container_name" text NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"credentials" text NOT NULL,
	"status" varchar(20) DEFAULT 'stopped' NOT NULL,
	"version" varchar(20),
	"bind_localhost" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "infrastructure_services_container_name_unique" UNIQUE("container_name"),
	CONSTRAINT "infrastructure_services_port_unique" UNIQUE("port")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"github_url" text NOT NULL,
	"root_directory" text DEFAULT './',
	"build_command" text NOT NULL,
	"app_type" varchar(50) NOT NULL,
	"domain" varchar(255),
	"port" integer,
	"github_repo_id" text,
	"github_repo_full_name" text,
	"github_branch" text DEFAULT 'main',
	"github_installation_id" text,
	"auto_deploy" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "projects_domain_unique" UNIQUE("domain"),
	CONSTRAINT "projects_port_unique" UNIQUE("port")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_logs" ADD CONSTRAINT "build_logs_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "infrastructure_services" ADD CONSTRAINT "infrastructure_services_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_installation_id_github_installations_github_installation_id_fk" FOREIGN KEY ("github_installation_id") REFERENCES "public"."github_installations"("github_installation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "build_logs_build_id_idx" ON "build_logs" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "build_logs_timestamp_idx" ON "build_logs" USING btree ("build_id","timestamp");--> statement-breakpoint
CREATE INDEX "builds_project_id_idx" ON "builds" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "deployments_build_id_idx" ON "deployments" USING btree ("build_id");--> statement-breakpoint
CREATE INDEX "deployments_status_idx" ON "deployments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "env_vars_project_id_idx" ON "environment_variables" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "env_vars_project_key_unique" ON "environment_variables" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "infra_service_type_idx" ON "infrastructure_services" USING btree ("service_type");--> statement-breakpoint
CREATE INDEX "infra_status_idx" ON "infrastructure_services" USING btree ("status");--> statement-breakpoint
CREATE INDEX "projects_github_repo_idx" ON "projects" USING btree ("github_repo_id","github_branch");