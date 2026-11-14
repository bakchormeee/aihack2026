ALTER TYPE "public"."error_type" ADD VALUE 'arithmetic_slip';--> statement-breakpoint
ALTER TYPE "public"."error_type" ADD VALUE 'notation';--> statement-breakpoint
ALTER TABLE "mark" ADD COLUMN "mistakes" jsonb;