// Working for several questions at once (SPEC-batch-working.md): which questions of a
// sheet can take working.

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { attempts, questions, submissions } from "@/db/schema";
import { requireSheet } from "@/lib/auth/ownership";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

export type BatchQuestion = {
  id: string;
  label: string;
  body: string;
  /** False when the question's latest attempt on the sheet is already submitted. */
  canTakeWorking: boolean;
  /** The latest attempt on the sheet (not in a revision session), if there is one. */
  latestAttemptId: string | null;
};

/** The sheet's questions in order, each with whether it can take working now. */
export async function sheetQuestionStates(
  executor: Executor,
  userId: string,
  sheetId: string,
): Promise<BatchQuestion[]> {
  const rows = await executor
    .select({ id: questions.id, label: questions.label, body: questions.body })
    .from(questions)
    .where(eq(questions.sheetId, sheetId))
    .orderBy(asc(questions.position));
  if (rows.length === 0) return [];

  const tries = await executor
    .select({
      id: attempts.id,
      questionId: attempts.questionId,
      submittedAt: submissions.submittedAt,
    })
    .from(attempts)
    .leftJoin(submissions, eq(submissions.attemptId, attempts.id))
    .where(
      and(
        eq(attempts.userId, userId),
        isNull(attempts.revisionSessionId),
        inArray(
          attempts.questionId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(desc(attempts.startedAt), desc(attempts.id));

  const latest = new Map<string, (typeof tries)[number]>();
  for (const t of tries) if (!latest.has(t.questionId)) latest.set(t.questionId, t);

  return rows.map((row) => {
    const attempt = latest.get(row.id);
    return {
      ...row,
      canTakeWorking: !attempt?.submittedAt,
      latestAttemptId: attempt?.id ?? null,
    };
  });
}

/**
 * The sheet (NotFoundError unless it is the user's) and, when it is ready, its
 * questions with whether each can take working.
 */
export async function getBatchQuestions(userId: string, sheetId: string) {
  const sheet = await requireSheet(userId, sheetId);
  if (sheet.status !== "ready") return { ready: false as const, questions: [] };
  return { ready: true as const, questions: await sheetQuestionStates(db, userId, sheetId) };
}
