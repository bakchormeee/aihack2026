CREATE TYPE "public"."demo_role" AS ENUM('template', 'copy');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "demo_role" "demo_role";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "demo_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "demo_ai_calls" integer DEFAULT 0 NOT NULL;