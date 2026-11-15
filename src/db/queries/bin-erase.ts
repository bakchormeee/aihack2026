// Erasing for good (SPEC-delete.md, section 4). 30 days after a course or sheet went to
// the bin, it is erased with everything it took (section 2), then its own stored files.
// This is the only place that deletes rows of the append-only tables (attempts,
// submissions, hint reveals, marks). It runs in the background for one user's own items.

import { and, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  attempts,
  courses,
  hintReveals,
  marks,
  questions,
  revisionItems,
  revisionSessions,
  sheetFiles,
  sheets,
  submissionFiles,
  submissions,
} from "@/db/schema";
import { binnedQuestionIds, isDueForErasing } from "@/lib/bin/rules";
import { deleteObject } from "@/lib/storage/s3";

export type EraseIo = { deleteObject(key: string): Promise<void> };
const defaultIo: EraseIo = { deleteObject };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** `column in ids`, false for no ids. */
function within(column: PgColumn, ids: string[]): SQL {
  return ids.length ? inArray(column, ids) : sql`false`;
}

/**
 * Deletes the history on the given questions, in foreign-key order (these tables have no
 * cascade), and returns the paths of the submission files it deleted.
 */
async function eraseHistory(tx: Tx, questionIds: string[], sessionIds: string[]) {
  const attemptIds = (
    await tx
      .select({ id: attempts.id })
      .from(attempts)
      .where(
        or(
          within(attempts.questionId, questionIds),
          within(attempts.revisionSessionId, sessionIds),
        ),
      )
  ).map((a) => a.id);
  const submissionIds = (
    await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(within(submissions.attemptId, attemptIds))
  ).map((s) => s.id);
  const files = await tx
    .select({ path: submissionFiles.path })
    .from(submissionFiles)
    .where(within(submissionFiles.submissionId, submissionIds));

  await tx.delete(hintReveals).where(within(hintReveals.attemptId, attemptIds));
  await tx.delete(submissionFiles).where(within(submissionFiles.submissionId, submissionIds));
  await tx.delete(submissions).where(within(submissions.id, submissionIds));
  // Misconception sources and read marks cascade from the marks and attempts.
  await tx.delete(marks).where(within(marks.attemptId, attemptIds));
  await tx
    .delete(revisionItems)
    .where(
      or(
        within(revisionItems.questionId, questionIds),
        within(revisionItems.sessionId, sessionIds),
      ),
    );
  await tx.delete(attempts).where(within(attempts.id, attemptIds));
  return files.map((f) => f.path);
}

/** Erases a due course with everything in it. Returns the stored paths it used, or null if it was not erased. */
async function eraseCourse(tx: Tx, userId: string, courseId: string, now: Date) {
  const [course] = await tx
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
    .for("update");
  if (!course?.deletedAt || !isDueForErasing(course.deletedAt, now)) return null;

  const questionIds = (
    await tx.select({ id: questions.id }).from(questions).where(eq(questions.courseId, courseId))
  ).map((q) => q.id);
  const sessionIds = (
    await tx
      .select({ id: revisionSessions.id })
      .from(revisionSessions)
      .where(eq(revisionSessions.courseId, courseId))
  ).map((s) => s.id);
  const sheetPaths = await tx
    .select({ path: sheetFiles.path })
    .from(sheetFiles)
    .innerJoin(sheets, eq(sheetFiles.sheetId, sheets.id))
    .where(eq(sheets.courseId, courseId));
  const submissionPaths = await eraseHistory(tx, questionIds, sessionIds);
  // Topics, sheets, questions, sessions and common errors cascade from the course.
  await tx.delete(courses).where(eq(courses.id, courseId));
  return [...sheetPaths.map((f) => f.path), ...submissionPaths];
}

/** Erases a due sheet with its questions and their variants. Returns the stored paths it used, or null. */
async function eraseSheet(tx: Tx, userId: string, sheetId: string, now: Date) {
  const [row] = await tx
    .select({ sheet: sheets })
    .from(sheets)
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(and(eq(sheets.id, sheetId), eq(courses.userId, userId)))
    .for("update");
  const sheet = row?.sheet;
  if (!sheet?.deletedAt || !isDueForErasing(sheet.deletedAt, now)) return null;

  const links = await tx
    .select({
      id: questions.id,
      sheetId: questions.sheetId,
      parentQuestionId: questions.parentQuestionId,
    })
    .from(questions)
    .where(eq(questions.courseId, sheet.courseId));
  const questionIds = [...binnedQuestionIds(links, new Set([sheet.id]))];
  const sheetPaths = await tx
    .select({ path: sheetFiles.path })
    .from(sheetFiles)
    .where(eq(sheetFiles.sheetId, sheet.id));
  const submissionPaths = await eraseHistory(tx, questionIds, []);
  // Variants have no sheet, so they go by id; hints, solutions and topics cascade.
  await tx.delete(questions).where(within(questions.id, questionIds));
  await tx.delete(sheets).where(eq(sheets.id, sheet.id));
  return [...sheetPaths.map((f) => f.path), ...submissionPaths];
}

/**
 * Deletes the stored files that only the erased rows used: paths under the user's own
 * folder (never a demo template's file read by a demo copy) that no remaining row
 * uses (a retry copies a submission's photos). A failed delete is logged.
 */
async function deleteUnusedFiles(userId: string, paths: string[], io: EraseIo) {
  const own = [...new Set(paths)].filter((p) => p.startsWith(`u/${userId}/`));
  if (own.length === 0) return;
  const stillUsed = new Set([
    ...(
      await db
        .select({ path: sheetFiles.path })
        .from(sheetFiles)
        .where(inArray(sheetFiles.path, own))
    ).map((f) => f.path),
    ...(
      await db
        .select({ path: submissionFiles.path })
        .from(submissionFiles)
        .where(inArray(submissionFiles.path, own))
    ).map((f) => f.path),
  ]);
  for (const key of own) {
    if (stillUsed.has(key)) continue;
    try {
      await io.deleteObject(key);
    } catch (error) {
      console.error(`Bin erase: could not delete ${key}`, error);
    }
  }
}

/**
 * Erases the user's binned courses and sheets that have been in the bin for 30 days,
 * each in its own transaction, then their files. Safe to run twice. Returns the ids erased.
 */
export async function eraseDueBinItems(
  userId: string,
  now: Date = new Date(),
  io: EraseIo = defaultIo,
): Promise<{ courses: string[]; sheets: string[] }> {
  const binnedCourses = await db
    .select({ id: courses.id, deletedAt: courses.deletedAt })
    .from(courses)
    .where(and(eq(courses.userId, userId), isNotNull(courses.deletedAt)));
  const erased = { courses: [] as string[], sheets: [] as string[] };
  const paths: string[] = [];

  for (const course of binnedCourses) {
    if (!isDueForErasing(course.deletedAt!, now)) continue;
    const used = await db.transaction((tx) => eraseCourse(tx, userId, course.id, now));
    if (used) {
      erased.courses.push(course.id);
      paths.push(...used);
    }
  }

  // Read after the courses, so a sheet erased with its course is not seen.
  const binnedSheets = await db
    .select({ id: sheets.id, deletedAt: sheets.deletedAt })
    .from(sheets)
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(and(eq(courses.userId, userId), isNotNull(sheets.deletedAt)));
  for (const sheet of binnedSheets) {
    if (!isDueForErasing(sheet.deletedAt!, now)) continue;
    const used = await db.transaction((tx) => eraseSheet(tx, userId, sheet.id, now));
    if (used) {
      erased.sheets.push(sheet.id);
      paths.push(...used);
    }
  }

  await deleteUnusedFiles(userId, paths, io);
  return erased;
}

/** For the pages that run the erase in `after()`: a failure is logged, never shown. */
export function logEraseFailure(error: unknown): void {
  console.error("Bin erase failed", error);
}
