// Ownership checks (SPEC.md, `accounts`). Every server action, route handler
// and page loads user data through these helpers. Each returns the row if it
// belongs to `userId` and throws NotFoundError otherwise, with the same error
// for a missing id and for another user's id, so ids cannot be probed.
//
// This file is frozen after task F4.

import { and, eq } from "drizzle-orm";

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

export async function requireCourse(userId: string, courseId: string) {
  return first(
    await db
      .select()
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.userId, userId))),
  );
}

export async function requireSheet(userId: string, sheetId: string) {
  const rows = await db
    .select({ sheet: sheets })
    .from(sheets)
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(and(eq(sheets.id, sheetId), eq(courses.userId, userId)));
  return first(rows).sheet;
}

// Ownership of a question is decided by its course, because a revision
// variant has no sheet.
export async function requireQuestion(userId: string, questionId: string) {
  const rows = await db
    .select({ question: questions })
    .from(questions)
    .innerJoin(courses, eq(questions.courseId, courses.id))
    .where(and(eq(questions.id, questionId), eq(courses.userId, userId)));
  return first(rows).question;
}

export async function requireAttempt(userId: string, attemptId: string) {
  return first(
    await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId))),
  );
}

export async function requireSheetFile(userId: string, fileId: string) {
  const rows = await db
    .select({ file: sheetFiles })
    .from(sheetFiles)
    .innerJoin(sheets, eq(sheetFiles.sheetId, sheets.id))
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(and(eq(sheetFiles.id, fileId), eq(courses.userId, userId)));
  return first(rows).file;
}

export async function requireSubmissionFile(userId: string, fileId: string) {
  const rows = await db
    .select({ file: submissionFiles })
    .from(submissionFiles)
    .innerJoin(submissions, eq(submissionFiles.submissionId, submissions.id))
    .innerJoin(attempts, eq(submissions.attemptId, attempts.id))
    .where(and(eq(submissionFiles.id, fileId), eq(attempts.userId, userId)));
  return first(rows).file;
}

export async function requireRevisionSession(userId: string, sessionId: string) {
  return first(
    await db
      .select()
      .from(revisionSessions)
      .where(and(eq(revisionSessions.id, sessionId), eq(revisionSessions.userId, userId))),
  );
}
