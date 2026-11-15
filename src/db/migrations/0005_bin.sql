ALTER TABLE "course" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sheet" ADD COLUMN "deleted_at" timestamp with time zone;