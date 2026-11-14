// Sheet queries (tasks M2–M5 share this file; each adds its own functions).

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { courses, sheetFiles, sheets } from "@/db/schema";
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
