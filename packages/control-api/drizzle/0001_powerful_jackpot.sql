CREATE TABLE "domain_provisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subdomain" varchar(255) NOT NULL,
	"full_domain" varchar(255) NOT NULL,
	"dns_record_id" text,
	"dns_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"ssl_status" varchar(20) DEFAULT 'pending' NOT NULL,
	"ssl_cert_path" text,
	"ssl_expiry" timestamp,
	"server_ip" text NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "domain_provisions_full_domain_unique" UNIQUE("full_domain")
);
--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "status_message" text;--> statement-breakpoint
ALTER TABLE "deployments" ADD COLUMN "failed_at_step" varchar(50);--> statement-breakpoint
ALTER TABLE "domain_provisions" ADD CONSTRAINT "domain_provisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_provisions_project_id_idx" ON "domain_provisions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "domain_provisions_domain_idx" ON "domain_provisions" USING btree ("full_domain");