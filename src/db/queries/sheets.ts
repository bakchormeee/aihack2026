// Sheet queries (tasks M2–M5 share this file; each adds its own functions).

import { and, asc, desc, eq, inArray, lt, or } from "drizzle-orm";

import { db } from "@/db";
import { courses, questionTopics, questions, sheetFiles, sheets, topics } from "@/db/schema";
import { STALE_JOB_MS } from "@/lib/domain";
import { MAX_IMAGES_PER_SHEET_UPLOAD, type UploadCheck } from "@/lib/storage/limits";
import type { UploadPurpose } from "@/lib/storage/keys";

/** One PDF, or up to 10 images; not both. */
export function checkSheetFileSet(mimes: string[]): UploadCheck {
  if (mimes.length === 0) return { ok: false, message: "Upload a PDF or some images." };
  const pdfs = mimes.filter((m) => m === "application/pdf").length;
  if (pdfs > 0 && mimes.length > 1)
    return { ok: false, message: "Use one PDF, or several images, not both." };
  if (mimes.length > MAX_IMAGES_PER_SHEET_UPLOAD) {
    return { ok: false, message: `Use at most ${MAX_IMAGES_PER_SHEET_UPLOAD} images.` };
  }
  return { ok: true };
}

/** True when `key` was issued for this user, purpose and parent (see buildKey). */
export function keyIsUnder(
  key: string,
  userId: string,
  purpose: UploadPurpose,
  parentId: string,
): boolean {
  return key.startsWith(`u/${userId}/${purpose}/${parentId}/`);
}

/** A readable default title from an uploaded file name. */
export function titleFromFileName(fileName: string): string {
  const title = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title.length > 0 ? title.slice(0, 150) : "Untitled sheet";
}

export async function createSheetWithFiles(
  courseId: string,
  title: string,
  files: { path: string; mime: string }[],
) {
  return db.transaction(async (tx) => {
    const [sheet] = await tx.insert(sheets).values({ courseId, title }).returning();
    await tx.insert(sheetFiles).values(
      files.map((file, position) => ({
        sheetId: sheet.id,
        kind: "sheet" as const,
        path: file.path,
        mime: file.mime,
        position,
      })),
    );
    return sheet;
  });
}

/** The course's sheets, newest first. Empty unless the course belongs to `userId`. */
export async function listSheets(userId: string, courseId: string) {
  const rows = await db
    .select({ sheet: sheets })
    .from(sheets)
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(and(eq(sheets.courseId, courseId), eq(courses.userId, userId)))
    .orderBy(desc(sheets.uploadedAt));
  return rows.map((row) => row.sheet);
}

/**
 * Puts a failed (or stuck) sheet back to `parsing` so the job can run again.
 * Returns false, changing nothing, unless the sheet is the user's and is
 * failed or has been parsing for longer than STALE_JOB_MS.
 */
export async function requeueParse(userId: string, sheetId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_JOB_MS);
  const rows = await db
    .update(sheets)
    .set({ status: "parsing", statusUpdatedAt: new Date(), error: null })
    .where(
      and(
        eq(sheets.id, sheetId),
        inArray(
          sheets.courseId,
          db.select({ id: courses.id }).from(courses).where(eq(courses.userId, userId)),
        ),
        or(
          eq(sheets.status, "failed"),
          and(eq(sheets.status, "parsing"), lt(sheets.statusUpdatedAt, staleBefore)),
        ),
      ),
    )
    .returning({ id: sheets.id });
  return rows.length > 0;
}

/** A sheet's questions in order, each with its topics. Empty unless the sheet is the user's. */
export async function listQuestionsWithTopics(userId: string, sheetId: string) {
  const rows = await db
    .select({ question: questions })
    .from(questions)
    .innerJoin(sheets, eq(questions.sheetId, sheets.id))
    .innerJoin(courses, eq(sheets.courseId, courses.id))
    .where(and(eq(questions.sheetId, sheetId), eq(courses.userId, userId)))
    .orderBy(asc(questions.position));
  if (rows.length === 0) return [];

  const tags = await db
    .select({ questionId: questionTopics.questionId, id: topics.id, name: topics.name })
    .from(questionTopics)
    .innerJoin(topics, eq(questionTopics.topicId, topics.id))
    .where(
      inArray(
        questionTopics.questionId,
        rows.map((row) => row.question.id),
      ),
    );

  return rows.map(({ question }) => ({
    ...question,
    topics: tags
      .filter((tag) => tag.questionId === question.id)
      .map(({ id, name }) => ({ id, name })),
  }));
}

/**
 * Puts failed (or stuck) questions of the user's sheet back to `pending` so
 * their hints are written again. Returns how many were restarted.
 */
export async function requeueHintsForSheet(userId: string, sheetId: string): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_JOB_MS);
  const rows = await db
    .update(questions)
    .set({ hintsStatus: "pending", hintsStatusUpdatedAt: new Date() })
    .where(
      and(
        eq(questions.sheetId, sheetId),
        inArray(
          questions.courseId,
          db.select({ id: courses.id }).from(courses).where(eq(courses.userId, userId)),
        ),
        or(
          eq(questions.hintsStatus, "failed"),
          and(
            eq(questions.hintsStatus, "pending"),
            lt(questions.hintsStatusUpdatedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning({ id: questions.id });
  return rows.length;
}

/** Switches the sheet's timer on or off. Returns false unless the sheet is the user's. */
export async function setTimerEnabled(
  userId: string,
  sheetId: string,
  enabled: boolean,
): Promise<boolean> {
  const rows = await db
    .update(sheets)
    .set({ timerEnabled: enabled })
    .where(
      and(
        eq(sheets.id, sheetId),
        inArray(
          sheets.courseId,
          db.select({ id: courses.id }).from(courses).where(eq(courses.userId, userId)),
        ),
      ),
    )
    .returning({ id: sheets.id });
  return rows.length > 0;
}
