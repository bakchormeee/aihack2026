// The whole V1 data model (SPEC.md, "Data model"). This file is frozen after
// task F2: tracks must not edit it. Ask the coordinator for any change.
//
// Rules that the schema encodes:
// - Every row belongs to one user, directly or through its parent.
// - Attempts, submitted submissions, hint reveals and marks are append-only.
// - Mastery is not stored; it is computed from attempts and marks on read.

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  ATTEMPT_CONTEXTS,
  ERROR_TYPES,
  HINTS_STATUSES,
  MARK_BASES,
  MARK_STATUSES,
  OUTCOMES,
  QUESTION_SOURCES,
  REVISION_ITEM_SOURCES,
  SESSION_MODES,
  SESSION_STATUSES,
  SHEET_FILE_KINDS,
  SHEET_STATUSES,
  SOLUTIONS_STATUSES,
  type Mistake,
  type PlantedError,
  type SpotJudgement,
  type SpotTick,
} from "@/lib/domain";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = (name = "created_at") =>
  timestamp(name, { mode: "date", withTimezone: true }).notNull().defaultNow();
const instant = (name: string) => timestamp(name, { mode: "date", withTimezone: true });

export const outcomeEnum = pgEnum("outcome", OUTCOMES);
export const errorTypeEnum = pgEnum("error_type", ERROR_TYPES);
export const markBasisEnum = pgEnum("mark_basis", MARK_BASES);
export const sheetStatusEnum = pgEnum("sheet_status", SHEET_STATUSES);
export const solutionsStatusEnum = pgEnum("solutions_status", SOLUTIONS_STATUSES);
export const hintsStatusEnum = pgEnum("hints_status", HINTS_STATUSES);
export const markStatusEnum = pgEnum("mark_status", MARK_STATUSES);
export const sessionModeEnum = pgEnum("session_mode", SESSION_MODES);
export const sessionStatusEnum = pgEnum("session_status", SESSION_STATUSES);
export const sheetFileKindEnum = pgEnum("sheet_file_kind", SHEET_FILE_KINDS);
export const questionSourceEnum = pgEnum("question_source", QUESTION_SOURCES);
export const attemptContextEnum = pgEnum("attempt_context", ATTEMPT_CONTEXTS);
export const revisionItemSourceEnum = pgEnum("revision_item_source", REVISION_ITEM_SOURCES);

// ── Accounts. Property names are those the Auth.js Drizzle adapter requires. ──

export const users = pgTable("user", {
  id: id(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: instant("email_verified"),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("session", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// ── Courses and topics. A course is one university module. ──

export const courses = pgTable(
  "course",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("course_user_idx").on(t.userId)],
);

export const topics = pgTable(
  "topic",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: text("parent_id").references((): AnyPgColumn => topics.id, { onDelete: "set null" }),
  },
  // Two sheets parsed at the same time must not create the same topic twice.
  (t) => [uniqueIndex("topic_course_name_unique").on(t.courseId, sql`lower(${t.name})`)],
);

export const topicPrereqs = pgTable(
  "topic_prereq",
  {
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    prereqId: text("prereq_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.topicId, t.prereqId] })],
);

// ── Sheets and questions ──

export const sheets = pgTable(
  "sheet",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: sheetStatusEnum("status").notNull().default("parsing"),
    statusUpdatedAt: createdAt("status_updated_at"),
    error: text("error"),
    timerEnabled: boolean("timer_enabled").notNull().default(true),
    uploadedAt: createdAt("uploaded_at"),
    solutionsStatus: solutionsStatusEnum("solutions_status").notNull().default("none"),
    solutionsStatusUpdatedAt: instant("solutions_status_updated_at"),
    solutionsUploadedAt: instant("solutions_uploaded_at"),
  },
  (t) => [index("sheet_course_idx").on(t.courseId)],
);

export const sheetFiles = pgTable(
  "sheet_file",
  {
    id: id(),
    sheetId: text("sheet_id")
      .notNull()
      .references(() => sheets.id, { onDelete: "cascade" }),
    kind: sheetFileKindEnum("kind").notNull(),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("sheet_file_sheet_idx").on(t.sheetId)],
);

export const questions = pgTable(
  "question",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    // Null for a variant generated for revision.
    sheetId: text("sheet_id").references(() => sheets.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    body: text("body").notNull(),
    expectedMinutes: integer("expected_minutes").notNull(),
    source: questionSourceEnum("source").notNull().default("original"),
    parentQuestionId: text("parent_question_id").references((): AnyPgColumn => questions.id, {
      onDelete: "set null",
    }),
    hintsStatus: hintsStatusEnum("hints_status").notNull().default("pending"),
    hintsStatusUpdatedAt: createdAt("hints_status_updated_at"),
  },
  (t) => [index("question_sheet_idx").on(t.sheetId), index("question_course_idx").on(t.courseId)],
);

export const questionTopics = pgTable(
  "question_topic",
  {
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    topicId: text("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.topicId] })],
);

export const hints = pgTable(
  "hint",
  {
    id: id(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    body: text("body").notNull(),
  },
  (t) => [uniqueIndex("hint_question_level_unique").on(t.questionId, t.level)],
);

export const solutions = pgTable(
  "solution",
  {
    id: id(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    basis: markBasisEnum("basis").notNull(),
    body: text("body").notNull(),
  },
  (t) => [uniqueIndex("solution_question_basis_unique").on(t.questionId, t.basis)],
);

// ── Revision sessions (declared before attempts, which refer to them) ──

export const revisionSessions = pgTable("revision_session", {
  id: id(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  // Long-form sessions are sized in minutes, spot-the-error sessions in questions.
  targetMinutes: integer("target_minutes"),
  mode: sessionModeEnum("mode").notNull().default("long_form"),
  questionCount: integer("question_count"),
  // Null means all topics of the course.
  topicIds: jsonb("topic_ids").$type<string[]>(),
  status: sessionStatusEnum("status").notNull().default("building"),
  statusUpdatedAt: createdAt("status_updated_at"),
  createdAt: createdAt(),
});

export const revisionItems = pgTable(
  "revision_item",
  {
    sessionId: text("session_id")
      .notNull()
      .references(() => revisionSessions.id, { onDelete: "cascade" }),
    // The question to attempt: the original for a retry, the new question for a variant.
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    position: integer("position").notNull(),
    source: revisionItemSourceEnum("source").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.position] })],
);

// ── Attempts, working and marks. No cascade from questions: history is kept. ──

export const attempts = pgTable(
  "attempt",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id),
    context: attemptContextEnum("context").notNull(),
    revisionSessionId: text("revision_session_id").references(() => revisionSessions.id),
    startedAt: createdAt("started_at"),
    // Null when the timer is switched off for the sheet.
    secondsSpent: integer("seconds_spent"),
    // Hints already visible when the attempt started ("retry now").
    inheritedHintLevel: integer("inherited_hint_level").notNull().default(0),
    difficultyRating: integer("difficulty_rating"),
  },
  (t) => [index("attempt_user_question_idx").on(t.userId, t.questionId)],
);

export const hintReveals = pgTable(
  "hint_reveal",
  {
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id),
    hintId: text("hint_id")
      .notNull()
      .references(() => hints.id),
    revealedAt: createdAt("revealed_at"),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.hintId] })],
);

export const submissions = pgTable("submission", {
  id: id(),
  // One submission per attempt.
  attemptId: text("attempt_id")
    .notNull()
    .unique()
    .references(() => attempts.id),
  text: text("text"),
  // Null while the working is a draft.
  submittedAt: instant("submitted_at"),
  markStatus: markStatusEnum("mark_status").notNull().default("none"),
  markStatusUpdatedAt: createdAt("mark_status_updated_at"),
});

export const submissionFiles = pgTable(
  "submission_file",
  {
    id: id(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => submissions.id),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("submission_file_submission_idx").on(t.submissionId)],
);

export const marks = pgTable(
  "mark",
  {
    id: id(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id),
    basis: markBasisEnum("basis").notNull(),
    score: integer("score").notNull(),
    outcome: outcomeEnum("outcome").notNull(),
    errorType: errorTypeEnum("error_type"),
    // Every mistake, boxed on the mark screen (Marking v2). Null only for marks made before it.
    mistakes: jsonb("mistakes").$type<Mistake[]>(),
    firstWrongStep: text("first_wrong_step"),
    // Feedback anchored to the first wrong step.
    feedback: text("feedback").notNull(),
    overallFeedback: text("overall_feedback").notNull(),
    isDispute: boolean("is_dispute").notNull().default(false),
    disputeReason: text("dispute_reason"),
    // Set on an official mark whose outcome differs from the latest AI mark.
    outcomeChanged: boolean("outcome_changed").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("mark_attempt_idx").on(t.attemptId)],
);

export const sheetSummaries = pgTable("sheet_summary", {
  sheetId: text("sheet_id")
    .primaryKey()
    .references(() => sheets.id, { onDelete: "cascade" }),
  bodyJson: jsonb("body_json")
    .$type<{ wentWell: string[]; wasHard: string[]; nextSteps: string[] }>()
    .notNull(),
  generatedAt: createdAt("generated_at"),
});

// ── Common errors and spot-the-error (SPEC-spot-the-error.md) ──

/** One recurring error of one student in one course, in words. Times seen is computed on read. */
export const misconceptions = pgTable(
  "misconception",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    errorType: errorTypeEnum("error_type").notNull(),
    createdAt: createdAt(),
    // "Not me": a hidden misconception is never planted or shown.
    hiddenAt: instant("hidden_at"),
  },
  (t) => [index("misconception_course_idx").on(t.userId, t.courseId)],
);

/** A mistake placed in a misconception. Old marks have one source, at index 0, from the first wrong step. */
export const misconceptionSources = pgTable(
  "misconception_source",
  {
    misconceptionId: text("misconception_id")
      .notNull()
      .references(() => misconceptions.id, { onDelete: "cascade" }),
    markId: text("mark_id")
      .notNull()
      .references(() => marks.id, { onDelete: "cascade" }),
    mistakeIndex: integer("mistake_index").notNull(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    topicIds: jsonb("topic_ids").$type<string[]>().notNull(),
    quote: text("quote").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.markId, t.mistakeIndex] }),
    index("misconception_source_misconception_idx").on(t.misconceptionId),
  ],
);

/** Marks the grouping job has read, so it only sends new ones. */
export const misconceptionMarks = pgTable("misconception_mark", {
  markId: text("mark_id")
    .primaryKey()
    .references(() => marks.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  processedAt: createdAt("processed_at"),
});

/** The claim on a course's grouping job: building while it runs, ready or failed after. */
export const misconceptionJobs = pgTable(
  "misconception_job",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    status: sessionStatusEnum("status").notNull().default("building"),
    statusUpdatedAt: createdAt("status_updated_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.courseId] })],
);

/** A question of a spot-the-error session: a worked solution as numbered lines, with 0-2 planted errors. */
export const spotItems = pgTable(
  "spot_item",
  {
    id: id(),
    sessionId: text("session_id")
      .notNull()
      .references(() => revisionSessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    body: text("body").notNull(),
    lines: jsonb("lines").$type<string[]>().notNull(),
    planted: jsonb("planted").$type<PlantedError[]>().notNull(),
    topicIds: jsonb("topic_ids").$type<string[]>().notNull(),
    expectedMinutes: integer("expected_minutes").notNull().default(3),
  },
  (t) => [uniqueIndex("spot_item_session_position_unique").on(t.sessionId, t.position)],
);

/** The student's one answer to a spot-the-error question. `answeredAt` is null until they answer. */
export const spotAnswers = pgTable("spot_answer", {
  itemId: text("item_id")
    .primaryKey()
    .references(() => spotItems.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  startedAt: createdAt("started_at"),
  answeredAt: instant("answered_at"),
  secondsSpent: integer("seconds_spent"),
  noError: boolean("no_error").notNull().default(false),
  ticked: jsonb("ticked").$type<SpotTick[]>().notNull().default([]),
  judgements: jsonb("judgements").$type<SpotJudgement[]>().notNull().default([]),
  outcome: outcomeEnum("outcome"),
});
