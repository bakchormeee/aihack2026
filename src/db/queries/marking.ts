// Marks, as shown on the mark screen (tasks M9, M10 and the R track add to this file).

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  attempts,
  hintReveals,
  hints,
  marks,
  questions,
  solutions,
  submissionFiles,
  submissions,
} from "@/db/schema";
import { requireAttempt, requireQuestion, requireSheet } from "@/lib/auth/ownership";
import type { HintLevel, Outcome } from "@/lib/domain";
import { attemptHintLevel, canDispute, currentMark, isSolutionUnlocked } from "@/lib/marking/rules";
import { claimMark, type ClaimedMark } from "@/lib/pipeline/mark";

export async function getMarkScreenData(userId: string, attemptId: string) {
  const attempt = await requireAttempt(userId, attemptId);
  const [question] = await db.select().from(questions).where(eq(questions.id, attempt.questionId));
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.attemptId, attemptId));
  const files = submission
    ? await db
        .select()
        .from(submissionFiles)
        .where(eq(submissionFiles.submissionId, submission.id))
        .orderBy(asc(submissionFiles.position))
    : [];
  const all = await db
    .select()
    .from(marks)
    .where(eq(marks.attemptId, attemptId))
    .orderBy(asc(marks.createdAt));

  return {
    attempt,
    question,
    submission: submission ? { ...submission, files } : null,
    marks: all,
    current: currentMark(all),
  };
}

/**
 * The worked solution, or null while it is locked. This is the ONLY place that
 * reads the `solution` table for display, so that a locked solution can never
 * reach the browser. It unlocks when one of the user's attempts has a full
 * current mark, or when the user has seen all three hints (on any attempt).
 * On the solutions review page (`reviewMode`) it also unlocks for a question
 * with a submitted attempt once the official solution exists. The official
 * solution is shown in preference to the AI one.
 */
export async function getVisibleSolution(
  userId: string,
  questionId: string,
  options: { reviewMode?: boolean } = {},
): Promise<{ basis: "ai" | "official"; body: string } | null> {
  await requireQuestion(userId, questionId);

  const mine = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.userId, userId), eq(attempts.questionId, questionId)));
  const ids = mine.map((attempt) => attempt.id);

  const [allMarks, reveals, submitted, solutionRows] = await Promise.all([
    ids.length ? db.select().from(marks).where(inArray(marks.attemptId, ids)) : [],
    ids.length
      ? db
          .select({ attemptId: hintReveals.attemptId, level: hints.level })
          .from(hintReveals)
          .innerJoin(hints, eq(hintReveals.hintId, hints.id))
          .where(inArray(hintReveals.attemptId, ids))
      : [],
    ids.length
      ? db
          .select({ attemptId: submissions.attemptId })
          .from(submissions)
          .where(and(inArray(submissions.attemptId, ids), isNotNull(submissions.submittedAt)))
      : [],
    db.select().from(solutions).where(eq(solutions.questionId, questionId)),
  ]);

  const hasFullAttempt = mine.some(
    (attempt) =>
      currentMark(allMarks.filter((mark) => mark.attemptId === attempt.id))?.outcome === "full",
  );
  const maxHintLevelRevealed = mine.reduce<HintLevel>((highest, attempt) => {
    const level = attemptHintLevel(
      attempt.inheritedHintLevel as HintLevel,
      reveals.filter((reveal) => reveal.attemptId === attempt.id).map((reveal) => reveal.level),
    );
    return level > highest ? level : highest;
  }, 0);
  const official = solutionRows.find((row) => row.basis === "official");

  const unlocked = isSolutionUnlocked({
    hasFullAttempt,
    maxHintLevelRevealed,
    reviewMode: options.reviewMode ?? false,
    hasSubmittedAttempt: submitted.length > 0,
    hasOfficialSolution: official !== undefined,
  });
  if (!unlocked) return null;

  const chosen = official ?? solutionRows.find((row) => row.basis === "ai");
  return chosen ? { basis: chosen.basis, body: chosen.body } : null;
}

/** True when the question has an official solution (uploaded on its sheet's Solutions tab). */
export async function hasOfficialSolution(userId: string, questionId: string): Promise<boolean> {
  await requireQuestion(userId, questionId);
  const rows = await db
    .select({ id: solutions.questionId })
    .from(solutions)
    .where(and(eq(solutions.questionId, questionId), eq(solutions.basis, "official")));
  return rows.length > 0;
}

export type ReviewItem = {
  question: { id: string; label: string; body: string };
  attemptId: string;
  startedAt: Date;
  text: string | null;
  files: { id: string; mime: string }[];
  /** The attempt's current mark (the official one once it exists). */
  mark: { score: number; outcome: Outcome; basis: "ai" | "official"; outcomeChanged: boolean };
  /** The latest AI mark, for comparison with an official one. */
  earlierAi: { score: number; outcome: Outcome } | null;
};

const OUTCOME_RANK: Record<Outcome, number> = { stuck: 0, partial: 1, full: 2 };

/**
 * What the Solutions tab shows once the official solutions are in: first the
 * attempts whose official outcome differs from the earlier AI outcome, then,
 * for each remaining question, the best submitted attempt when its outcome is
 * not full. Each list is in question order.
 */
export async function getSolutionsReview(
  userId: string,
  sheetId: string,
): Promise<{ changed: ReviewItem[]; notFull: ReviewItem[] }> {
  await requireSheet(userId, sheetId);
  const sheetQuestions = await db
    .select()
    .from(questions)
    .where(eq(questions.sheetId, sheetId))
    .orderBy(asc(questions.position));
  if (sheetQuestions.length === 0) return { changed: [], notFull: [] };

  const rows = await db
    .select({ attempt: attempts, submission: submissions })
    .from(attempts)
    .innerJoin(submissions, eq(submissions.attemptId, attempts.id))
    .where(
      and(
        eq(attempts.userId, userId),
        inArray(
          attempts.questionId,
          sheetQuestions.map((q) => q.id),
        ),
        isNotNull(submissions.submittedAt),
      ),
    );
  if (rows.length === 0) return { changed: [], notFull: [] };

  const [allMarks, allFiles] = await Promise.all([
    db
      .select()
      .from(marks)
      .where(
        inArray(
          marks.attemptId,
          rows.map((r) => r.attempt.id),
        ),
      ),
    db
      .select()
      .from(submissionFiles)
      .where(
        inArray(
          submissionFiles.submissionId,
          rows.map((r) => r.submission.id),
        ),
      )
      .orderBy(asc(submissionFiles.position)),
  ]);

  const items = rows.flatMap(({ attempt, submission }): ReviewItem[] => {
    const own = allMarks.filter((m) => m.attemptId === attempt.id);
    const current = currentMark(own);
    const question = sheetQuestions.find((q) => q.id === attempt.questionId);
    if (!current || !question) return [];
    const ai = currentMark(own.filter((m) => m.basis === "ai"));
    return [
      {
        question: { id: question.id, label: question.label, body: question.body },
        attemptId: attempt.id,
        startedAt: attempt.startedAt,
        text: submission.text,
        files: allFiles
          .filter((f) => f.submissionId === submission.id)
          .map((f) => ({ id: f.id, mime: f.mime })),
        mark: {
          score: current.score,
          outcome: current.outcome,
          basis: current.basis,
          outcomeChanged: current.basis === "official" && current.outcomeChanged,
        },
        earlierAi: ai ? { score: ai.score, outcome: ai.outcome } : null,
      },
    ];
  });

  const position = (item: ReviewItem) => sheetQuestions.findIndex((q) => q.id === item.question.id);
  const byQuestion = (a: ReviewItem, b: ReviewItem) => position(a) - position(b);

  const changed = items.filter((item) => item.mark.outcomeChanged).sort(byQuestion);
  const shown = new Set(changed.map((item) => item.attemptId));

  const notFull = sheetQuestions.flatMap((question) => {
    const mine = items.filter((item) => item.question.id === question.id);
    // The best attempt: highest outcome, then highest score, then the latest.
    const best = mine.reduce<(typeof mine)[number] | null>((top, item) => {
      if (!top) return item;
      const diff =
        OUTCOME_RANK[item.mark.outcome] - OUTCOME_RANK[top.mark.outcome] ||
        item.mark.score - top.mark.score ||
        item.startedAt.getTime() - top.startedAt.getTime();
      return diff > 0 ? item : top;
    }, null);
    return best && best.mark.outcome !== "full" && !shown.has(best.attemptId) ? [best] : [];
  });

  return { changed, notFull };
}

/** How far the official re-mark has got: submitted attempts with an official solution, and how many already have an official mark from this upload. */
export async function getRemarkProgress(
  userId: string,
  sheetId: string,
): Promise<{ total: number; marked: number }> {
  const sheet = await requireSheet(userId, sheetId);
  const official = await db
    .select({ id: solutions.questionId })
    .from(solutions)
    .innerJoin(questions, eq(solutions.questionId, questions.id))
    .where(and(eq(questions.sheetId, sheetId), eq(solutions.basis, "official")));
  if (official.length === 0) return { total: 0, marked: 0 };

  const rows = await db
    .select({ attemptId: attempts.id })
    .from(attempts)
    .innerJoin(submissions, eq(submissions.attemptId, attempts.id))
    .where(
      and(
        eq(attempts.userId, userId),
        inArray(
          attempts.questionId,
          official.map((o) => o.id),
        ),
        isNotNull(submissions.submittedAt),
      ),
    );
  if (rows.length === 0) return { total: 0, marked: 0 };
  const officialMarks = await db
    .select({ attemptId: marks.attemptId, createdAt: marks.createdAt })
    .from(marks)
    .where(
      and(
        eq(marks.basis, "official"),
        inArray(
          marks.attemptId,
          rows.map((r) => r.attemptId),
        ),
      ),
    );
  const since = sheet.solutionsUploadedAt;
  const marked = new Set(
    officialMarks.filter((m) => !since || m.createdAt >= since).map((m) => m.attemptId),
  );
  return { total: rows.length, marked: marked.size };
}

export const DISPUTE_REASON_MAX = 300;

/** The optional one-line reason for a dispute: trimmed, at most 300 characters. */
export const disputeReasonSchema = z.string().trim().max(DISPUTE_REASON_MAX).optional();

export class DisputeRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisputeRefusedError";
  }
}

/**
 * Starts a dispute ("I think this is right") of the attempt's current mark:
 * claims a new mark with the same basis and the reason. Pass the result to
 * performMark. At most two disputes per attempt, counted here on the server.
 * Throws NotFoundError for another user's attempt and DisputeRefusedError
 * when the dispute is not allowed.
 */
export async function startDispute(
  userId: string,
  attemptId: string,
  reason: string | undefined,
): Promise<ClaimedMark> {
  await requireAttempt(userId, attemptId);
  const parsed = disputeReasonSchema.safeParse(reason);
  if (!parsed.success) {
    throw new DisputeRefusedError(`Keep the reason to ${DISPUTE_REASON_MAX} characters.`);
  }

  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.attemptId, attemptId));
  const all = await db.select().from(marks).where(eq(marks.attemptId, attemptId));
  const current = currentMark(all);
  if (!submission?.submittedAt || !current) {
    throw new DisputeRefusedError("There is no mark to dispute yet.");
  }
  if (!canDispute(all.filter((mark) => mark.isDispute).length)) {
    throw new DisputeRefusedError("You have already disputed this attempt twice.");
  }

  const claim = await claimMark({
    submissionId: submission.id,
    basis: current.basis,
    disputeReason: parsed.data ?? "",
  });
  if (!claim) throw new DisputeRefusedError("This attempt is being marked. Please wait.");
  return claim;
}
