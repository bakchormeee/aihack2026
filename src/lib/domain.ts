// Shared domain vocabulary (contract C1 in tasks/plan.md).
// The database enums in src/db/schema.ts are built from these arrays, so a
// value can never exist in one place and not the other.

export const OUTCOMES = ["full", "partial", "stuck"] as const;
export const ERROR_TYPES = [
  "conceptual",
  "method",
  "algebra_slip",
  "misread_question",
  "incomplete",
] as const;
export const MARK_BASES = ["ai", "official"] as const;

export const SHEET_STATUSES = ["parsing", "ready", "failed"] as const;
export const SOLUTIONS_STATUSES = ["none", "extracting", "remarking", "done", "failed"] as const;
export const HINTS_STATUSES = ["pending", "ready", "failed"] as const;
export const MARK_STATUSES = ["none", "pending", "done", "failed"] as const;
export const SESSION_STATUSES = ["building", "ready", "failed"] as const;

export const SHEET_FILE_KINDS = ["sheet", "official_solutions"] as const;
export const QUESTION_SOURCES = ["original", "variant"] as const;
export const ATTEMPT_CONTEXTS = ["sheet", "revision"] as const;
export const REVISION_ITEM_SOURCES = ["retry", "variant"] as const;

export type Outcome = (typeof OUTCOMES)[number];
export type ErrorType = (typeof ERROR_TYPES)[number];
export type MarkBasis = (typeof MARK_BASES)[number];
export type SheetStatus = (typeof SHEET_STATUSES)[number];
export type SolutionsStatus = (typeof SOLUTIONS_STATUSES)[number];
export type HintsStatus = (typeof HINTS_STATUSES)[number];
export type MarkStatus = (typeof MARK_STATUSES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type SheetFileKind = (typeof SHEET_FILE_KINDS)[number];
export type QuestionSource = (typeof QUESTION_SOURCES)[number];
export type AttemptContext = (typeof ATTEMPT_CONTEXTS)[number];
export type RevisionItemSource = (typeof REVISION_ITEM_SOURCES)[number];

/** 0 means no hint was visible; 1–3 is the highest hint level visible. */
export type HintLevel = 0 | 1 | 2 | 3;

/** A background job in a waiting state for longer than this is shown as failed, with a retry. */
export const STALE_JOB_MS = 3 * 60 * 1000;
