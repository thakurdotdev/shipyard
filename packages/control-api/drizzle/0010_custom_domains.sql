ALTER TABLE "domain_provisions" ADD COLUMN "dns_zone_id" text;--> statement-breakpoint
ALTER TABLE "domain_provisions" ADD COLUMN "dns_record_owned" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_provisions" ADD COLUMN "alias_records" text;--> statement-breakpoint
ALTER TABLE "domain_provisions" ADD COLUMN "ssl_reused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "www_redirect" boolean DEFAULT false NOT NULL;