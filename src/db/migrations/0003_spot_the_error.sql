CREATE TYPE "public"."session_mode" AS ENUM('long_form', 'spot_error');--> statement-breakpoint
CREATE TABLE "misconception_job" (
	"user_id" text NOT NULL,
	"course_id" text NOT NULL,
	"status" "session_status" DEFAULT 'building' NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "misconception_job_user_id_course_id_pk" PRIMARY KEY("user_id","course_id")
);
--> statement-breakpoint
CREATE TABLE "misconception_mark" (
	"mark_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"course_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "misconception_source" (
	"misconception_id" text NOT NULL,
	"mark_id" text NOT NULL,
	"mistake_index" integer NOT NULL,
	"attempt_id" text NOT NULL,
	"topic_ids" jsonb NOT NULL,
	"quote" text NOT NULL,
	CONSTRAINT "misconception_source_mark_id_mistake_index_pk" PRIMARY KEY("mark_id","mistake_index")
);
--> statement-breakpoint
CREATE TABLE "misconception" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"course_id" text NOT NULL,
	"description" text NOT NULL,
	"error_type" "error_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spot_answer" (
	"item_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"seconds_spent" integer,
	"no_error" boolean DEFAULT false NOT NULL,
	"ticked" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"judgements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" "outcome"
);
--> statement-breakpoint
CREATE TABLE "spot_item" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"position" integer NOT NULL,
	"body" text NOT NULL,
	"lines" jsonb NOT NULL,
	"planted" jsonb NOT NULL,
	"topic_ids" jsonb NOT NULL,
	"expected_minutes" integer DEFAULT 3 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "revision_session" ALTER COLUMN "target_minutes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "revision_session" ADD COLUMN "mode" "session_mode" DEFAULT 'long_form' NOT NULL;--> statement-breakpoint
ALTER TABLE "revision_session" ADD COLUMN "question_count" integer;--> statement-breakpoint
ALTER TABLE "misconception_job" ADD CONSTRAINT "misconception_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_job" ADD CONSTRAINT "misconception_job_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_mark" ADD CONSTRAINT "misconception_mark_mark_id_mark_id_fk" FOREIGN KEY ("mark_id") REFERENCES "public"."mark"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_mark" ADD CONSTRAINT "misconception_mark_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_mark" ADD CONSTRAINT "misconception_mark_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_source" ADD CONSTRAINT "misconception_source_misconception_id_misconception_id_fk" FOREIGN KEY ("misconception_id") REFERENCES "public"."misconception"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_source" ADD CONSTRAINT "misconception_source_mark_id_mark_id_fk" FOREIGN KEY ("mark_id") REFERENCES "public"."mark"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception_source" ADD CONSTRAINT "misconception_source_attempt_id_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception" ADD CONSTRAINT "misconception_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "misconception" ADD CONSTRAINT "misconception_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_answer" ADD CONSTRAINT "spot_answer_item_id_spot_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."spot_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_answer" ADD CONSTRAINT "spot_answer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_item" ADD CONSTRAINT "spot_item_session_id_revision_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."revision_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "misconception_source_misconception_idx" ON "misconception_source" USING btree ("misconception_id");--> statement-breakpoint
CREATE INDEX "misconception_course_idx" ON "misconception" USING btree ("user_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spot_item_session_position_unique" ON "spot_item" USING btree ("session_id","position");