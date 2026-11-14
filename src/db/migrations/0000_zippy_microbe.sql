CREATE TYPE "public"."attempt_context" AS ENUM('sheet', 'revision');--> statement-breakpoint
CREATE TYPE "public"."error_type" AS ENUM('conceptual', 'method', 'algebra_slip', 'misread_question', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."hints_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."mark_basis" AS ENUM('ai', 'official');--> statement-breakpoint
CREATE TYPE "public"."mark_status" AS ENUM('none', 'pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('full', 'partial', 'stuck');--> statement-breakpoint
CREATE TYPE "public"."question_source" AS ENUM('original', 'variant');--> statement-breakpoint
CREATE TYPE "public"."revision_item_source" AS ENUM('retry', 'variant');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('building', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sheet_file_kind" AS ENUM('sheet', 'official_solutions');--> statement-breakpoint
CREATE TYPE "public"."sheet_status" AS ENUM('parsing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."solutions_status" AS ENUM('none', 'extracting', 'remarking', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "account" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"question_id" text NOT NULL,
	"context" "attempt_context" NOT NULL,
	"revision_session_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seconds_spent" integer,
	"inherited_hint_level" integer DEFAULT 0 NOT NULL,
	"difficulty_rating" integer
);
--> statement-breakpoint
CREATE TABLE "course" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hint_reveal" (
	"attempt_id" text NOT NULL,
	"hint_id" text NOT NULL,
	"revealed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hint_reveal_attempt_id_hint_id_pk" PRIMARY KEY("attempt_id","hint_id")
);
--> statement-breakpoint
CREATE TABLE "hint" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"level" integer NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mark" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"basis" "mark_basis" NOT NULL,
	"score" integer NOT NULL,
	"outcome" "outcome" NOT NULL,
	"error_type" "error_type",
	"first_wrong_step" text,
	"feedback" text NOT NULL,
	"overall_feedback" text NOT NULL,
	"is_dispute" boolean DEFAULT false NOT NULL,
	"dispute_reason" text,
	"outcome_changed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_topic" (
	"question_id" text NOT NULL,
	"topic_id" text NOT NULL,
	CONSTRAINT "question_topic_question_id_topic_id_pk" PRIMARY KEY("question_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"sheet_id" text,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"body" text NOT NULL,
	"expected_minutes" integer NOT NULL,
	"source" "question_source" DEFAULT 'original' NOT NULL,
	"parent_question_id" text,
	"hints_status" "hints_status" DEFAULT 'pending' NOT NULL,
	"hints_status_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision_item" (
	"session_id" text NOT NULL,
	"question_id" text NOT NULL,
	"position" integer NOT NULL,
	"source" "revision_item_source" NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "revision_item_session_id_position_pk" PRIMARY KEY("session_id","position")
);
--> statement-breakpoint
CREATE TABLE "revision_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"course_id" text NOT NULL,
	"target_minutes" integer NOT NULL,
	"topic_ids" jsonb,
	"status" "session_status" DEFAULT 'building' NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_file" (
	"id" text PRIMARY KEY NOT NULL,
	"sheet_id" text NOT NULL,
	"kind" "sheet_file_kind" NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet_summary" (
	"sheet_id" text PRIMARY KEY NOT NULL,
	"body_json" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sheet" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "sheet_status" DEFAULT 'parsing' NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"timer_enabled" boolean DEFAULT true NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"solutions_status" "solutions_status" DEFAULT 'none' NOT NULL,
	"solutions_status_updated_at" timestamp with time zone,
	"solutions_uploaded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "solution" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"basis" "mark_basis" NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_file" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"text" text,
	"submitted_at" timestamp with time zone,
	"mark_status" "mark_status" DEFAULT 'none' NOT NULL,
	"mark_status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_attempt_id_unique" UNIQUE("attempt_id")
);
--> statement-breakpoint
CREATE TABLE "topic_prereq" (
	"topic_id" text NOT NULL,
	"prereq_id" text NOT NULL,
	CONSTRAINT "topic_prereq_topic_id_prereq_id_pk" PRIMARY KEY("topic_id","prereq_id")
);
--> statement-breakpoint
CREATE TABLE "topic" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_token" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt" ADD CONSTRAINT "attempt_revision_session_id_revision_session_id_fk" FOREIGN KEY ("revision_session_id") REFERENCES "public"."revision_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hint_reveal" ADD CONSTRAINT "hint_reveal_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hint_reveal" ADD CONSTRAINT "hint_reveal_hint_id_hint_id_fk" FOREIGN KEY ("hint_id") REFERENCES "public"."hint"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hint" ADD CONSTRAINT "hint_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mark" ADD CONSTRAINT "mark_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_topic" ADD CONSTRAINT "question_topic_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_topic" ADD CONSTRAINT "question_topic_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_sheet_id_sheet_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_parent_question_id_question_id_fk" FOREIGN KEY ("parent_question_id") REFERENCES "public"."question"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_item" ADD CONSTRAINT "revision_item_session_id_revision_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."revision_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_item" ADD CONSTRAINT "revision_item_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_session" ADD CONSTRAINT "revision_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_session" ADD CONSTRAINT "revision_session_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_file" ADD CONSTRAINT "sheet_file_sheet_id_sheet_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_summary" ADD CONSTRAINT "sheet_summary_sheet_id_sheet_id_fk" FOREIGN KEY ("sheet_id") REFERENCES "public"."sheet"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solution" ADD CONSTRAINT "solution_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_file" ADD CONSTRAINT "submission_file_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_prereq" ADD CONSTRAINT "topic_prereq_topic_id_topic_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_prereq" ADD CONSTRAINT "topic_prereq_prereq_id_topic_id_fk" FOREIGN KEY ("prereq_id") REFERENCES "public"."topic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic" ADD CONSTRAINT "topic_parent_id_topic_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."topic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempt_user_question_idx" ON "attempt" USING btree ("user_id","question_id");--> statement-breakpoint
CREATE INDEX "course_user_idx" ON "course" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hint_question_level_unique" ON "hint" USING btree ("question_id","level");--> statement-breakpoint
CREATE INDEX "mark_attempt_idx" ON "mark" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "question_sheet_idx" ON "question" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "question_course_idx" ON "question" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "sheet_file_sheet_idx" ON "sheet_file" USING btree ("sheet_id");--> statement-breakpoint
CREATE INDEX "sheet_course_idx" ON "sheet" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "solution_question_basis_unique" ON "solution" USING btree ("question_id","basis");--> statement-breakpoint
CREATE INDEX "submission_file_submission_idx" ON "submission_file" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_course_name_unique" ON "topic" USING btree ("course_id",lower("name"));