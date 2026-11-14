// Marks, as shown on the mark screen (tasks M9, M10 and the R track add to this file).

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { marks, questions, submissionFiles, submissions } from "@/db/schema";
import { requireAttempt } from "@/lib/auth/ownership";
import { currentMark } from "@/lib/marking/rules";

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
