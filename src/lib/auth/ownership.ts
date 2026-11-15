// Ownership checks (SPEC.md, `accounts`). Every server action, route handler
// and page loads user data through these helpers. Each returns the row if it
// belongs to `userId` and throws NotFoundError otherwise, with the same error
// for a missing id and for another user's id, so ids cannot be probed.
//
// An item in the bin (SPEC-delete.md) is refused like a missing one: a binned
// course with everything in it, and a binned sheet with its questions, the
// revision variants descended from them, and the attempts and files on those.
// Restore and the Recently deleted page use their own queries (db/queries/bin.ts).
//
// This file is frozen after task F4 (edited by D2 for the bin).

import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  attempts,
  courses,
  questions,
  revisionSessions,
  sheetFiles,
  sheets,
  submissionFiles,
  submissions,
} from "@/db/schema";
import { binnedQuestionIds } from "@/lib/bin/rules";

export class NotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "NotFoundError";
  }
}

function first<T>(rows: T[]): T {
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}

/** Throws NotFoundError when the question went to the bin with a binned sheet (variants included). */
async function refuseBinnedQuestion(question: { id: string; courseId: string }): Promise<void> {
  const binned = await db
    .select({ id: sheets.id })
    .from(sheets)
    .where(and(eq(sheets.courseId, question.courseId), isNotNull(sheets.deletedAt)));
  if (binned.length === 0) return;
  const links = await db
    .select({
      id: questions.id,
      sheetId: questions.sheetId,
      parentQuestionId: questions.parentQuestionId,
    })
    .from(questions)
    .where(eq(questions.courseId, question.courseId));
  if (binnedQuestionIds(links, new Set(binned.map((s) => s.id))).has(question.id)) {
    throw new NotFoundError();
  }
}

export async function requireCourse(userId: string, courseId: string) {
  return first(
    await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.userId, userId), isNull(courses.deletedAt))),
  );
}

export async function requireSheet(userId: string, sheetId: string) {
  const rows = await db
    .select({ sheet: sheets })
    .from(sheets)
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(
      and(
        eq(sheets.id, sheetId),
        eq(courses.userId, userId),
        isNull(sheets.deletedAt),
        isNull(courses.deletedAt),
      ),
    );
  return first(rows).sheet;
}

// Ownership of a question is decided by its course, because a revision
// variant has no sheet.
export async function requireQuestion(userId: string, questionId: string) {
  const rows = await db
    .select({ question: questions })
    .from(questions)
    .innerJoin(courses, eq(questions.courseId, courses.id))
    .where(
      and(eq(questions.id, questionId), eq(courses.userId, userId), isNull(courses.deletedAt)),
    );
  const { question } = first(rows);
  await refuseBinnedQuestion(question);
  return question;
}

export async function requireAttempt(userId: string, attemptId: string) {
  const rows = await db
    .select({ attempt: attempts, courseId: courses.id })
    .from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .innerJoin(courses, eq(questions.courseId, courses.id))
    .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId), isNull(courses.deletedAt)));
  const { attempt, courseId } = first(rows);
  await refuseBinnedQuestion({ id: attempt.questionId, courseId });
  return attempt;
}

export async function requireSheetFile(userId: string, fileId: string) {
  const rows = await db
    .select({ file: sheetFiles })
    .from(sheetFiles)
    .innerJoin(sheets, eq(sheetFiles.sheetId, sheets.id))
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(
      and(
        eq(sheetFiles.id, fileId),
        eq(courses.userId, userId),
        isNull(sheets.deletedAt),
        isNull(courses.deletedAt),
      ),
    );
  return first(rows).file;
}

export async function requireSubmissionFile(userId: string, fileId: string) {
  const rows = await db
    .select({ file: submissionFiles, questionId: attempts.questionId, courseId: courses.id })
    .from(submissionFiles)
    .innerJoin(submissions, eq(submissionFiles.submissionId, submissions.id))
    .innerJoin(attempts, eq(submissions.attemptId, attempts.id))
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .innerJoin(courses, eq(questions.courseId, courses.id))
    .where(
      and(eq(submissionFiles.id, fileId), eq(attempts.userId, userId), isNull(courses.deletedAt)),
    );
  const { file, questionId, courseId } = first(rows);
  await refuseBinnedQuestion({ id: questionId, courseId });
  return file;
}

export async function requireRevisionSession(userId: string, sessionId: string) {
  const rows = await db
    .select({ session: revisionSessions })
    .from(revisionSessions)
    .innerJoin(courses, eq(revisionSessions.courseId, courses.id))
    .where(
      and(
        eq(revisionSessions.id, sessionId),
        eq(revisionSessions.userId, userId),
        isNull(courses.deletedAt),
      ),
    );
  return first(rows).session;
}
