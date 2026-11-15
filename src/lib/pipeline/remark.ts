// Background job: read the official solutions of a sheet with the AI, save
// them, then mark every submitted attempt on the sheet again against them
// (task R1). Marks are only ever added. Safe to run twice: the sheet is claimed
// with a conditional update, so only one run proceeds.

import { and, asc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";

import { db } from "@/db";
import {
  attempts,
  courses,
  marks,
  questions,
  sheetFiles,
  sheets,
  solutions,
  submissions,
} from "@/db/schema";
import { withAiUser } from "@/lib/ai/budget";
import { extractSolutions } from "@/lib/ai/extract-solutions";
import { markAttempt } from "@/lib/ai/mark-attempt";
import { requireSheet } from "@/lib/auth/ownership";
import { mapLimit } from "@/lib/concurrency";
import { STALE_JOB_MS } from "@/lib/domain";
import { getObjectBytes } from "@/lib/storage";

import { claimMark, performMark, type MarkIo } from "./mark";

export type RemarkIo = {
  readFile: (key: string) => Promise<Buffer>;
  extract: typeof extractSolutions;
  mark: MarkIo;
};

const defaultIo: RemarkIo = {
  readFile: getObjectBytes,
  extract: extractSolutions,
  mark: { readFile: getObjectBytes, mark: markAttempt },
};

export const REMARK_CONCURRENCY = 5;

/** The sheets a run may claim: idle ones, or ones whose run has not moved for STALE_JOB_MS. */
function claimable(sheetId: string) {
  const staleBefore = new Date(Date.now() - STALE_JOB_MS);
  return and(
    eq(sheets.id, sheetId),
    or(
      inArray(sheets.solutionsStatus, ["none", "failed", "done"]),
      and(
        inArray(sheets.solutionsStatus, ["extracting", "remarking"]),
        lt(sheets.solutionsStatusUpdatedAt, staleBefore),
      ),
    ),
  );
}

/** Takes the right to run the job (status extracting). False when another run holds the sheet. */
async function claimSheet(sheetId: string): Promise<boolean> {
  const rows = await db
    .update(sheets)
    .set({ solutionsStatus: "extracting", solutionsStatusUpdatedAt: new Date() })
    .where(claimable(sheetId))
    .returning({ id: sheets.id });
  return rows.length > 0;
}

/**
 * Stores newly uploaded official solution files (replacing earlier ones) and
 * claims the sheet, in one step. Throws NotFoundError for a sheet that is not
 * the user's. Returns false, changing nothing, when a run is already going.
 */
export async function startOfficialSolutions(
  userId: string,
  sheetId: string,
  files: { path: string; mime: string }[],
): Promise<boolean> {
  await requireSheet(userId, sheetId);
  return db.transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx
      .update(sheets)
      .set({
        solutionsStatus: "extracting",
        solutionsStatusUpdatedAt: now,
        solutionsUploadedAt: now,
      })
      .where(claimable(sheetId))
      .returning({ id: sheets.id });
    if (claimed.length === 0) return false;

    await tx
      .delete(sheetFiles)
      .where(and(eq(sheetFiles.sheetId, sheetId), eq(sheetFiles.kind, "official_solutions")));
    await tx.insert(sheetFiles).values(
      files.map((file, position) => ({
        sheetId,
        kind: "official_solutions" as const,
        path: file.path,
        mime: file.mime,
        position,
      })),
    );
    return true;
  });
}

/** Retry: claims a failed or stale sheet whose files are already stored. */
export async function restartOfficialRemark(userId: string, sheetId: string): Promise<boolean> {
  await requireSheet(userId, sheetId);
  return claimSheet(sheetId);
}

/** Claims and runs in one go. Used by tests. */
export async function runOfficialRemark(sheetId: string, io?: RemarkIo): Promise<void> {
  if (await claimSheet(sheetId)) await performOfficialRemark(sheetId, io);
}

/** The slow part, after the sheet was claimed. Never throws; a failure sets the status to failed. */
export async function performOfficialRemark(sheetId: string, io?: RemarkIo): Promise<void> {
  const deps = io ?? defaultIo;
  const touch = (status: "remarking" | "done" | "failed", from: ("extracting" | "remarking")[]) =>
    db
      .update(sheets)
      .set({ solutionsStatus: status, solutionsStatusUpdatedAt: new Date() })
      .where(and(eq(sheets.id, sheetId), inArray(sheets.solutionsStatus, from)))
      .returning({ id: sheets.id });

  try {
    const [sheet] = await db.select().from(sheets).where(eq(sheets.id, sheetId));
    const [course] = await db.select().from(courses).where(eq(courses.id, sheet.courseId));
    const sheetQuestions = await db
      .select()
      .from(questions)
      .where(eq(questions.sheetId, sheetId))
      .orderBy(asc(questions.position));
    const files = await db
      .select()
      .from(sheetFiles)
      .where(and(eq(sheetFiles.sheetId, sheetId), eq(sheetFiles.kind, "official_solutions")))
      .orderBy(asc(sheetFiles.position));
    if (files.length === 0) throw new Error("the sheet has no official solutions file");

    const fileData = await Promise.all(
      files.map(async (file) => ({ mime: file.mime, data: await deps.readFile(file.path) })),
    );
    // Each re-mark below counts its own call: performMark runs it as the attempt's user.
    const extracted = await withAiUser(course.userId, () =>
      deps.extract({
        files: fileData,
        questions: sheetQuestions.map((q) => ({ id: q.id, label: q.label, body: q.body })),
      }),
    );
    const known = new Set(sheetQuestions.map((q) => q.id));
    const found = extracted.solutions.filter((s) => known.has(s.questionId));
    for (const solution of found) {
      await db
        .insert(solutions)
        .values({ questionId: solution.questionId, basis: "official", body: solution.body })
        .onConflictDoUpdate({
          target: [solutions.questionId, solutions.basis],
          set: { body: solution.body },
        });
    }

    if ((await touch("remarking", ["extracting"])).length === 0) return; // another run took over

    // Every submitted attempt on a question that has an official solution,
    // except one that already has an official mark from this upload.
    const withOfficial = (
      await db
        .select({ id: solutions.questionId })
        .from(solutions)
        .where(
          and(
            eq(solutions.basis, "official"),
            inArray(
              solutions.questionId,
              sheetQuestions.map((q) => q.id),
            ),
          ),
        )
    ).map((row) => row.id);
    const submitted = withOfficial.length
      ? await db
          .select({ submissionId: submissions.id, attemptId: attempts.id })
          .from(submissions)
          .innerJoin(attempts, eq(submissions.attemptId, attempts.id))
          .where(
            and(
              eq(attempts.userId, course.userId),
              inArray(attempts.questionId, withOfficial),
              isNotNull(submissions.submittedAt),
            ),
          )
      : [];
    const existing = submitted.length
      ? await db
          .select({ attemptId: marks.attemptId, createdAt: marks.createdAt })
          .from(marks)
          .where(
            and(
              eq(marks.basis, "official"),
              inArray(
                marks.attemptId,
                submitted.map((s) => s.attemptId),
              ),
            ),
          )
      : [];
    const since = sheet.solutionsUploadedAt;
    const alreadyDone = new Set(
      existing.filter((m) => !since || m.createdAt >= since).map((m) => m.attemptId),
    );
    const todo = submitted.filter((s) => !alreadyDone.has(s.attemptId));

    const claims = (
      await Promise.all(
        todo.map((s) => claimMark({ submissionId: s.submissionId, basis: "official" })),
      )
    ).filter((claim) => claim !== null);
    await mapLimit(claims, REMARK_CONCURRENCY, async (claim) => {
      await performMark(claim, deps.mark);
      await touch("remarking", ["remarking"]); // progress: keeps the job from looking stale
    });

    const failed = claims.length
      ? await db
          .select({ id: submissions.id })
          .from(submissions)
          .where(
            and(
              eq(submissions.markStatus, "failed"),
              inArray(
                submissions.id,
                claims.map((c) => c.submissionId),
              ),
            ),
          )
      : [];
    await touch(failed.length > 0 ? "failed" : "done", ["remarking"]);
  } catch (error) {
    console.error(`official re-mark of sheet ${sheetId} failed`, error);
    await touch("failed", ["extracting", "remarking"]);
  }
}
