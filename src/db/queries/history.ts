// Sheet history, per-sheet statistics, the sheet summary and the mistake log
// (track H). Everything is loaded for one user and filtered by that user id;
// another user's ids give empty results.

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  attempts,
  courses,
  hintReveals,
  hints,
  marks,
  questions,
  questionTopics,
  sheetSummaries,
  sheets,
  submissionFiles,
  submissions,
  topics,
} from "@/db/schema";
import type { ErrorType, HintLevel, MarkBasis, Outcome } from "@/lib/domain";
import { attemptHintLevel, currentMark } from "@/lib/marking/rules";
import { isStale } from "@/lib/pipeline/stale";

import { listSheets } from "./sheets";

type Mark = typeof marks.$inferSelect;

export type AttemptRecord = {
  id: string;
  questionId: string;
  startedAt: Date;
  secondsSpent: number | null;
  inheritedHintLevel: number;
  /** Hints revealed during this attempt (not counting inherited ones). */
  revealedLevels: number[];
  hintLevel: HintLevel;
  difficultyRating: number | null;
  submission: {
    id: string;
    text: string | null;
    submittedAt: Date | null;
    markStatus: string;
    files: { id: string; mime: string; position: number }[];
  } | null;
  /** Oldest first. */
  marks: Mark[];
  /** An official mark beats an AI mark; otherwise the latest. */
  current: Mark | null;
};

export type QuestionRecord = {
  question: typeof questions.$inferSelect;
  sheetTitle: string | null;
  topics: { id: string; name: string }[];
  /** Oldest first. */
  attempts: AttemptRecord[];
};

const isSubmitted = (a: AttemptRecord) => a.submission?.submittedAt != null;

/**
 * Loads the user's questions (all of a course, or of one sheet) with every
 * attempt, its working, hint reveals and marks. Questions come in sheet order.
 */
async function loadRecords(
  userId: string,
  where: { courseId: string } | { sheetId: string },
): Promise<QuestionRecord[]> {
  const scope =
    "sheetId" in where
      ? eq(questions.sheetId, where.sheetId)
      : eq(questions.courseId, where.courseId);
  const rows = await db
    .select({ question: questions, sheetTitle: sheets.title, sheetUploadedAt: sheets.uploadedAt })
    .from(questions)
    .innerJoin(courses, eq(questions.courseId, courses.id))
    .leftJoin(sheets, eq(questions.sheetId, sheets.id))
    .where(and(scope, eq(courses.userId, userId)))
    .orderBy(asc(questions.position));
  if (rows.length === 0) return [];
  const questionIds = rows.map((row) => row.question.id);

  const [tags, attemptRows] = await Promise.all([
    db
      .select({ questionId: questionTopics.questionId, id: topics.id, name: topics.name })
      .from(questionTopics)
      .innerJoin(topics, eq(questionTopics.topicId, topics.id))
      .where(inArray(questionTopics.questionId, questionIds)),
    db
      .select()
      .from(attempts)
      .where(and(eq(attempts.userId, userId), inArray(attempts.questionId, questionIds)))
      .orderBy(asc(attempts.startedAt)),
  ]);
  const attemptIds = attemptRows.map((attempt) => attempt.id);

  const [markRows, reveals, submissionRows] = attemptIds.length
    ? await Promise.all([
        db
          .select()
          .from(marks)
          .where(inArray(marks.attemptId, attemptIds))
          .orderBy(asc(marks.createdAt)),
        db
          .select({ attemptId: hintReveals.attemptId, level: hints.level })
          .from(hintReveals)
          .innerJoin(hints, eq(hintReveals.hintId, hints.id))
          .where(inArray(hintReveals.attemptId, attemptIds)),
        db.select().from(submissions).where(inArray(submissions.attemptId, attemptIds)),
      ])
    : [[], [], []];
  const fileRows = submissionRows.length
    ? await db
        .select()
        .from(submissionFiles)
        .where(
          inArray(
            submissionFiles.submissionId,
            submissionRows.map((row) => row.id),
          ),
        )
        .orderBy(asc(submissionFiles.position))
    : [];

  const records: AttemptRecord[] = attemptRows.map((attempt) => {
    const revealedLevels = reveals.filter((r) => r.attemptId === attempt.id).map((r) => r.level);
    const attemptMarks = markRows.filter((m) => m.attemptId === attempt.id);
    const submission = submissionRows.find((s) => s.attemptId === attempt.id);
    return {
      id: attempt.id,
      questionId: attempt.questionId,
      startedAt: attempt.startedAt,
      secondsSpent: attempt.secondsSpent,
      inheritedHintLevel: attempt.inheritedHintLevel,
      revealedLevels,
      hintLevel: attemptHintLevel(attempt.inheritedHintLevel as HintLevel, revealedLevels),
      difficultyRating: attempt.difficultyRating,
      submission: submission
        ? {
            id: submission.id,
            text: submission.text,
            submittedAt: submission.submittedAt,
            markStatus: submission.markStatus,
            files: fileRows
              .filter((file) => file.submissionId === submission.id)
              .map(({ id, mime, position }) => ({ id, mime, position })),
          }
        : null,
      marks: attemptMarks,
      current: currentMark(attemptMarks),
    };
  });

  return rows.map(({ question, sheetTitle }) => ({
    question,
    sheetTitle,
    topics: tags
      .filter((tag) => tag.questionId === question.id)
      .map(({ id, name }) => ({ id, name })),
    attempts: records.filter((record) => record.questionId === question.id),
  }));
}

/** Every question of the sheet, in order, with all of the user's attempts at it. */
export async function getSheetHistory(userId: string, sheetId: string): Promise<QuestionRecord[]> {
  return loadRecords(userId, { sheetId });
}

// ── Sheet statistics and heat strip ──

const OUTCOME_RANK: Record<Outcome, number> = { full: 2, partial: 1, stuck: 0 };

/** The attempt with the best current outcome (then the fewest hints, then the newest). */
export function bestAttempt(list: AttemptRecord[]): AttemptRecord | null {
  let best: AttemptRecord | null = null;
  for (const attempt of list) {
    if (!attempt.current) continue;
    if (best === null) {
      best = attempt;
      continue;
    }
    const a = OUTCOME_RANK[attempt.current.outcome];
    const b = OUTCOME_RANK[best.current!.outcome];
    if (a > b || (a === b && attempt.hintLevel <= best.hintLevel)) best = attempt;
  }
  return best;
}

export type SheetStats = {
  total: number;
  submitted: number;
  /** Mean over marked questions of the best current score; null when nothing is marked. */
  averageScore: number | null;
  hintsRevealed: number;
  secondsSpent: number;
  /** True once any mark on the sheet is official. */
  confirmed: boolean;
};

export function sheetStats(records: QuestionRecord[]): SheetStats {
  const scores: number[] = [];
  let submitted = 0;
  let hintsRevealed = 0;
  let secondsSpent = 0;
  let confirmed = false;
  for (const record of records) {
    if (record.attempts.some(isSubmitted)) submitted += 1;
    const bestScore = record.attempts
      .map((a) => a.current?.score)
      .filter((score): score is number => score !== undefined);
    if (bestScore.length) scores.push(Math.max(...bestScore));
    for (const attempt of record.attempts) {
      hintsRevealed += attempt.revealedLevels.length;
      secondsSpent += attempt.secondsSpent ?? 0;
      if (attempt.marks.some((mark) => mark.basis === "official")) confirmed = true;
    }
  }
  return {
    total: records.length,
    submitted,
    averageScore: scores.length
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null,
    hintsRevealed,
    secondsSpent,
    confirmed,
  };
}

export type HeatRow = {
  sheetId: string;
  title: string;
  cells: { label: string; outcome: Outcome | null; hintLevel: HintLevel }[];
};

export function heatCells(records: QuestionRecord[]): HeatRow["cells"] {
  return records.map((record) => {
    const best = bestAttempt(record.attempts);
    return {
      label: record.question.label,
      outcome: best?.current?.outcome ?? null,
      hintLevel: best?.hintLevel ?? 0,
    };
  });
}

/** The course's sheets, newest first, each with its statistics and heat-strip row. */
export async function getCourseSheetOverview(userId: string, courseId: string) {
  const sheetRows = await listSheets(userId, courseId);
  if (sheetRows.length === 0) return [];
  const records = await loadRecords(userId, { courseId });
  return sheetRows.map((sheet) => {
    const own = records.filter((record) => record.question.sheetId === sheet.id);
    return {
      sheet,
      stats: sheetStats(own),
      heat: { sheetId: sheet.id, title: sheet.title, cells: heatCells(own) } satisfies HeatRow,
    };
  });
}

// ── Mistake log ──

export type MistakeItem = {
  attemptId: string;
  questionId: string;
  startedAt: Date;
  sheet: { id: string; title: string } | null;
  label: string;
  topics: { id: string; name: string }[];
  outcome: Outcome;
  basis: MarkBasis;
  errorType: ErrorType | null;
  feedback: string;
};

/**
 * Attempts in the course whose current mark is not full, newest first.
 * `topics` and `errorTypes` list the choices present before filtering.
 */
export async function listMistakes(
  userId: string,
  courseId: string,
  filters: { topicId?: string; errorType?: string },
) {
  const records = await loadRecords(userId, { courseId });
  const all: MistakeItem[] = [];
  for (const record of records) {
    for (const attempt of record.attempts) {
      const mark = attempt.current;
      if (!mark || mark.outcome === "full") continue;
      all.push({
        attemptId: attempt.id,
        questionId: record.question.id,
        startedAt: attempt.startedAt,
        sheet: record.question.sheetId
          ? { id: record.question.sheetId, title: record.sheetTitle ?? "" }
          : null,
        label: record.question.label,
        topics: record.topics,
        outcome: mark.outcome,
        basis: mark.basis,
        errorType: mark.errorType,
        feedback: mark.feedback,
      });
    }
  }
  all.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const topicChoices = new Map<string, string>();
  const errorChoices = new Set<ErrorType>();
  for (const item of all) {
    for (const topic of item.topics) topicChoices.set(topic.id, topic.name);
    if (item.errorType) errorChoices.add(item.errorType);
  }
  const items = all.filter(
    (item) =>
      (!filters.topicId || item.topics.some((topic) => topic.id === filters.topicId)) &&
      (!filters.errorType || item.errorType === filters.errorType),
  );
  return {
    items,
    topics: [...topicChoices].map(([id, name]) => ({ id, name })),
    errorTypes: [...errorChoices],
  };
}

// ── Sheet summary ──

/** The newest marked attempt of each question, ready for the summary and the hint ladder. */
export async function getSheetSummaryInput(userId: string, sheetId: string) {
  const records = await loadRecords(userId, { sheetId });
  const items: {
    label: string;
    topics: string[];
    outcome: Outcome;
    hintLevel: HintLevel;
    errorType: ErrorType | null;
    feedback: string;
  }[] = [];
  const ladder: [number, number, number, number] = [0, 0, 0, 0];
  let newestMarkAt: Date | null = null;

  for (const record of records) {
    for (const attempt of record.attempts) {
      for (const mark of attempt.marks) {
        if (newestMarkAt === null || mark.createdAt > newestMarkAt) newestMarkAt = mark.createdAt;
      }
    }
    const newest = [...record.attempts].reverse().find((attempt) => attempt.current !== null);
    if (!newest?.current) continue;
    items.push({
      label: record.question.label,
      topics: record.topics.map((topic) => topic.name),
      outcome: newest.current.outcome,
      hintLevel: newest.hintLevel,
      errorType: newest.current.errorType,
      feedback: newest.current.feedback,
    });
    // "Solved" means a full outcome.
    if (newest.current.outcome === "full") ladder[newest.hintLevel] += 1;
  }

  return {
    total: records.length,
    marked: items.length,
    complete: records.length > 0 && items.length === records.length,
    items,
    ladder,
    newestMarkAt,
  };
}

/** A summary needs (re)writing when there is none, or a mark is newer than it. */
export function summaryIsStale(generatedAt: Date | null, newestMarkAt: Date | null): boolean {
  if (generatedAt === null) return true;
  return newestMarkAt !== null && newestMarkAt > generatedAt;
}

type SummaryBody = { wentWell: string[]; wasHard: string[]; nextSteps: string[] };
type StoredBody = SummaryBody & { generating?: boolean; failed?: boolean };

const EMPTY_BODY: SummaryBody = { wentWell: [], wasHard: [], nextSteps: [] };

async function ownsSheet(userId: string, sheetId: string): Promise<boolean> {
  const rows = await db
    .select({ id: sheets.id })
    .from(sheets)
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(and(eq(sheets.id, sheetId), eq(courses.userId, userId)));
  return rows.length > 0;
}

/**
 * The stored summary: "ready" with its text, "generating" while one caller has
 * claimed it (an abandoned claim older than the stale limit counts as failed),
 * or "failed". Null when there is none or the sheet is not the user's.
 */
export async function readSummary(userId: string, sheetId: string) {
  if (!(await ownsSheet(userId, sheetId))) return null;
  const [row] = await db.select().from(sheetSummaries).where(eq(sheetSummaries.sheetId, sheetId));
  if (!row) return null;
  const body = row.bodyJson as StoredBody;
  if (body.generating) {
    return {
      state: isStale(row.generatedAt) ? ("failed" as const) : ("generating" as const),
      generatedAt: row.generatedAt,
    };
  }
  if (body.failed) return { state: "failed" as const, generatedAt: row.generatedAt };
  return {
    state: "ready" as const,
    body: { wentWell: body.wentWell, wasHard: body.wasHard, nextSteps: body.nextSteps },
    generatedAt: row.generatedAt,
  };
}

/**
 * Tries to take the right to write the summary. Returns the claim time (which
 * becomes `generated_at`, so a mark that arrives meanwhile makes it stale), or
 * null when another caller holds the claim, the summary is fresh or failed, or
 * the sheet is not the user's. The take-over is a compare-and-swap on
 * `generated_at`, so two page loads cannot both claim.
 */
export async function claimSummary(
  userId: string,
  sheetId: string,
  newestMarkAt: Date | null,
): Promise<Date | null> {
  if (!(await ownsSheet(userId, sheetId))) return null;
  const claimedAt = new Date();
  const claim = { ...EMPTY_BODY, generating: true } as SummaryBody;

  const inserted = await db
    .insert(sheetSummaries)
    .values({ sheetId, bodyJson: claim, generatedAt: claimedAt })
    .onConflictDoNothing()
    .returning({ sheetId: sheetSummaries.sheetId });
  if (inserted.length > 0) return claimedAt;

  const [row] = await db.select().from(sheetSummaries).where(eq(sheetSummaries.sheetId, sheetId));
  if (!row) return null;
  const body = row.bodyJson as StoredBody;
  const takeable = body.generating
    ? isStale(row.generatedAt)
    : !body.failed && summaryIsStale(row.generatedAt, newestMarkAt);
  if (!takeable) return null;

  const swapped = await db
    .update(sheetSummaries)
    .set({ bodyJson: claim, generatedAt: claimedAt })
    .where(
      and(
        eq(sheetSummaries.sheetId, sheetId),
        sql`${sheetSummaries.generatedAt} = ${row.generatedAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ sheetId: sheetSummaries.sheetId });
  return swapped.length > 0 ? claimedAt : null;
}

/** Stores the written summary, only if this caller's claim is still the current one. */
export async function finishSummary(sheetId: string, claimedAt: Date, body: SummaryBody) {
  await db
    .update(sheetSummaries)
    .set({ bodyJson: body })
    .where(
      and(
        eq(sheetSummaries.sheetId, sheetId),
        sql`${sheetSummaries.generatedAt} = ${claimedAt.toISOString()}::timestamptz`,
      ),
    );
}

/** Marks this caller's claim as failed, so the page offers a retry instead of looping. */
export async function failSummary(sheetId: string, claimedAt: Date) {
  await db
    .update(sheetSummaries)
    .set({ bodyJson: { ...EMPTY_BODY, failed: true } as SummaryBody })
    .where(
      and(
        eq(sheetSummaries.sheetId, sheetId),
        sql`${sheetSummaries.generatedAt} = ${claimedAt.toISOString()}::timestamptz`,
      ),
    );
}

/** Removes a failed (or abandoned) summary so the next page load writes it again. */
export async function retrySummary(userId: string, sheetId: string): Promise<void> {
  const current = await readSummary(userId, sheetId);
  if (current?.state !== "failed") return;
  await db.delete(sheetSummaries).where(eq(sheetSummaries.sheetId, sheetId));
}
