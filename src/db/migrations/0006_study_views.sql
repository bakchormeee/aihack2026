ALTER TYPE "public"."mark_status" ADD VALUE 'awaiting_official';--> statement-breakpoint
ALTER TABLE "sheet" ADD COLUMN "mark_with_ai" boolean DEFAULT true NOT NULL;