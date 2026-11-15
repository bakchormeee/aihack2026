// Background job: mark a submitted attempt with the AI (task M9, reused by
// disputes and by the official re-mark). Each run adds a mark; nothing is
// ever overwritten. Safe to run twice: only one run can claim and save.

import { and, asc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";

import { db } from "@/db";
import { attempts, marks, questions, solutions, submissionFiles, submissions } from "@/db/schema";
import { withAiUser } from "@/lib/ai/budget";
import { markAttempt } from "@/lib/ai/mark-attempt";
import { STALE_JOB_MS, type MarkBasis } from "@/lib/domain";
import { currentMark, outcomeFromScore } from "@/lib/marking/rules";
import { getObjectBytes } from "@/lib/storage";

import { refreshMisconceptions } from "./misconceptions";

export type MarkIo = {
  readFile: (key: string) => Promise<Buffer>;
  mark: typeof markAttempt;
  /** Brings the course's list of common errors up to date after a mark is saved. */
  refresh?: (userId: string, courseId: string) => Promise<void>;
};

const defaultIo: MarkIo = {
  readFile: getObjectBytes,
  mark: markAttempt,
  refresh: (userId, courseId) => refreshMisconceptions(userId, courseId),
};

export type MarkInput = { submissionId: string; basis: MarkBasis; disputeReason?: string };
export type ClaimedMark = MarkInput & { submission: typeof submissions.$inferSelect };

/**
 * Takes the right to mark a submission: sets its status to pending, in the
 * request, so that the page shows "marking" at once. Returns null when the
 * submission cannot be marked now (not submitted, already being marked, or
 * already marked and this is not a re-mark). Pass the result to performMark.
 */
export async function claimMark(input: MarkInput): Promise<ClaimedMark | null> {
  const { submissionId, basis, disputeReason } = input;

  // The first mark of a submission starts from none or failed. A re-mark (a
  // dispute or the official one) may also start from done.
  const isRemark = basis === "official" || disputeReason !== undefined;
  const startable = isRemark
    ? (["none", "done", "failed"] as const)
    : (["none", "failed"] as const);
  const staleBefore = new Date(Date.now() - STALE_JOB_MS);

  const claimed = await db
    .update(submissions)
    .set({ markStatus: "pending", markStatusUpdatedAt: new Date() })
    .where(
      and(
        eq(submissions.id, submissionId),
        isNotNull(submissions.submittedAt),
        or(
          inArray(submissions.markStatus, [...startable]),
          and(
            eq(submissions.markStatus, "pending"),
            lt(submissions.markStatusUpdatedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning();
  return claimed.length === 0 ? null : { ...input, submission: claimed[0] };
}

/** Claims and marks in one go. Used by tests and by jobs that are already in the background. */
export async function runMark(input: MarkInput, io: MarkIo = defaultIo): Promise<void> {
  const claim = await claimMark(input);
  if (claim) await performMark(claim, io);
}

/** The slow part: calls the AI and saves the mark. Never throws; a failure sets the status to failed. */
export async function performMark(claim: ClaimedMark, io: MarkIo = defaultIo): Promise<void> {
  const { submissionId, basis, disputeReason, submission } = claim;

  try {
    const [attempt] = await db.select().from(attempts).where(eq(attempts.id, submission.attemptId));
    const [question] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, attempt.questionId));
    const [solution] = await db
      .select()
      .from(solutions)
      .where(and(eq(solutions.questionId, question.id), eq(solutions.basis, basis)));
    if (!solution) throw new Error(`question ${question.id} has no ${basis} solution`);

    const files = await db
      .select()
      .from(submissionFiles)
      .where(eq(submissionFiles.submissionId, submission.id))
      .orderBy(asc(submissionFiles.position));
    const working = {
      text: submission.text,
      files: await Promise.all(
        files.map(async (file) => ({ mime: file.mime, data: await io.readFile(file.path) })),
      ),
    };

    const result = await withAiUser(attempt.userId, () =>
      io.mark({ questionBody: question.body, solution: solution.body, working, disputeReason }),
    );
    const outcome = outcomeFromScore(result.score);

    await db.transaction(async (tx) => {
      const done = await tx
        .update(submissions)
        .set({ markStatus: "done", markStatusUpdatedAt: new Date() })
        .where(and(eq(submissions.id, submission.id), eq(submissions.markStatus, "pending")))
        .returning({ id: submissions.id });
      if (done.length === 0) return; // another run took over

      const before = currentMark(
        await tx.select().from(marks).where(eq(marks.attemptId, attempt.id)),
      );
      await tx.insert(marks).values({
        attemptId: attempt.id,
        basis,
        score: result.score,
        outcome,
        mistakes: result.mistakes,
        // The first mistake summarises a wrong answer for the history lists; a correct one has none.
        errorType: outcome === "full" ? null : (result.mistakes[0]?.type ?? null),
        firstWrongStep: outcome === "full" ? null : (result.mistakes[0]?.quote ?? null),
        feedback: result.feedback,
        overallFeedback: result.overallFeedback,
        isDispute: disputeReason !== undefined,
        disputeReason: disputeReason?.trim() ? disputeReason.trim() : null,
        outcomeChanged: basis === "official" && before !== null && before.outcome !== outcome,
      });
    });

    // The mark is saved; a failure here must not turn it into a failed marking.
    try {
      await io.refresh?.(attempt.userId, question.courseId);
    } catch (error) {
      console.error(`refreshing common errors after marking ${submissionId} failed`, error);
    }
  } catch (error) {
    console.error(`marking submission ${submissionId} failed`, error);
    await db
      .update(submissions)
      .set({ markStatus: "failed", markStatusUpdatedAt: new Date() })
      .where(and(eq(submissions.id, submissionId), eq(submissions.markStatus, "pending")));
  }
}
