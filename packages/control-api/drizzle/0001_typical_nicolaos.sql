CREATE TABLE IF NOT EXISTS "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_installation_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_id" text NOT NULL,
	"account_type" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_github_installation_id_unique" UNIQUE("github_installation_id")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_repo_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_repo_full_name" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_branch" text DEFAULT 'main';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_installation_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_github_installation_id_github_installations_github_installation_id_fk" FOREIGN KEY ("github_installation_id") REFERENCES "github_installations"("github_installation_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
