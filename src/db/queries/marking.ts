// Marks, as shown on the mark screen (tasks M9, M10 and the R track add to this file).

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

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
import { requireAttempt, requireQuestion } from "@/lib/auth/ownership";
import type { HintLevel } from "@/lib/domain";
import { attemptHintLevel, currentMark, isSolutionUnlocked } from "@/lib/marking/rules";

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
