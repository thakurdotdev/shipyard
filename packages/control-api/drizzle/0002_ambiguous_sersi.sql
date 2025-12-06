ALTER TABLE "projects" ADD COLUMN "port" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_port_unique" UNIQUE("port");