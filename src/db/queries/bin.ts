// The bin (SPEC-delete.md): binning and restoring courses and sheets, and the helpers
// other queries use to leave binned work out. Binning only sets `deleted_at`; Restore
// only clears it (spec assumption 1). These queries read binned rows on purpose; every
// other query goes through the ownership guards, which refuse them.

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import { courses, questions, sheets } from "@/db/schema";
import { NotFoundError } from "@/lib/auth/ownership";
import { binnedQuestionIds } from "@/lib/bin/rules";

/** SQL condition: the course is not in the bin. */
export const liveCourse = isNull(courses.deletedAt);
/** SQL condition: the sheet is not in the bin (its course may still be). */
export const liveSheet = isNull(sheets.deletedAt);

/** The user's courses that are not binned, as a subquery of ids. */
const liveCourseIdsOf = (userId: string) =>
  db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.userId, userId), liveCourse));

/**
 * The questions of the course that went to the bin with a binned sheet: the sheet's
 * questions and every revision variant descended from them. It does not look at the
 * course's own `deleted_at` (a binned course is refused by the guards as a whole), so
 * a job that runs while its course is binned still sees its work.
 */
export async function binnedQuestionIdsOf(courseId: string): Promise<Set<string>> {
  const binned = await db
    .select({ id: sheets.id })
    .from(sheets)
    .where(and(eq(sheets.courseId, courseId), isNotNull(sheets.deletedAt)));
  if (binned.length === 0) return new Set();
  const links = await db
    .select({
      id: questions.id,
      sheetId: questions.sheetId,
      parentQuestionId: questions.parentQuestionId,
    })
    .from(questions)
    .where(eq(questions.courseId, courseId));
  return binnedQuestionIds(links, new Set(binned.map((s) => s.id)));
}

/** True when the user owns the course, whether or not it is in the bin. For background jobs. */
export async function ownsCourse(userId: string, courseId: string): Promise<boolean> {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)));
  return rows.length > 0;
}

/** Moves the user's course to the bin. Throws NotFoundError unless it is theirs and not binned. */
export async function binCourse(userId: string, courseId: string, now: Date = new Date()) {
  const rows = await db
    .update(courses)
    .set({ deletedAt: now })
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId), liveCourse))
    .returning();
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}

/**
 * Moves the user's sheet to the bin, with its questions and their variants. Throws
 * NotFoundError unless the sheet is theirs and neither it nor its course is binned.
 */
export async function binSheet(userId: string, sheetId: string, now: Date = new Date()) {
  const rows = await db
    .update(sheets)
    .set({ deletedAt: now })
    .where(
      and(eq(sheets.id, sheetId), liveSheet, inArray(sheets.courseId, liveCourseIdsOf(userId))),
    )
    .returning();
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}

/**
 * Brings a binned course back with everything in it. A sheet that was binned on its
 * own keeps its own date and stays in the bin.
 */
export async function restoreCourse(userId: string, courseId: string) {
  const rows = await db
    .update(courses)
    .set({ deletedAt: null })
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId), isNotNull(courses.deletedAt)))
    .returning();
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}

/**
 * Brings a binned sheet back. Throws NotFoundError unless it is the user's, is binned,
 * and its course is not (such a sheet comes back with its course).
 */
export async function restoreSheet(userId: string, sheetId: string) {
  const rows = await db
    .update(sheets)
    .set({ deletedAt: null })
    .where(
      and(
        eq(sheets.id, sheetId),
        isNotNull(sheets.deletedAt),
        inArray(sheets.courseId, liveCourseIdsOf(userId)),
      ),
    )
    .returning();
  if (rows.length === 0) throw new NotFoundError();
  return rows[0];
}
