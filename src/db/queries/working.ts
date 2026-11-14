// A student's working on an attempt: a draft that can be edited, then submitted
// once (task M8). A submitted submission is never changed.

import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { attempts, questions, submissionFiles, submissions } from "@/db/schema";
import { requireAttempt, requireSubmissionFile } from "@/lib/auth/ownership";

import { checkSheetFileSet } from "./sheets";

export const MAX_WORKING_TEXT = 20_000;

export class SubmissionLockedError extends Error {
  constructor() {
    super("This working has already been submitted and can no longer be changed.");
    this.name = "SubmissionLockedError";
  }
}

export class EmptyWorkingError extends Error {
  constructor() {
    super("Add some working first: type it, or attach photos or a PDF.");
    this.name = "EmptyWorkingError";
  }
}

export class WorkingFilesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkingFilesError";
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The attempt's submission row, created empty if there is none, and locked for this transaction. */
async function lockedDraft(tx: Tx, attemptId: string) {
  await tx.insert(submissions).values({ attemptId }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(submissions)
    .where(eq(submissions.attemptId, attemptId))
    .for("update");
  return row;
}

export async function getWorkingFor(userId: string, attemptId: string) {
  await requireAttempt(userId, attemptId);
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
  return {
    submissionId: submission?.id ?? null,
    text: submission?.text ?? null,
    submittedAt: submission?.submittedAt ?? null,
    markStatus: submission?.markStatus ?? ("none" as const),
    files,
  };
}

export async function saveDraftText(
  userId: string,
  attemptId: string,
  text: string,
): Promise<void> {
  if (text.length > MAX_WORKING_TEXT)
    throw new RangeError(`Typed working can be at most ${MAX_WORKING_TEXT} characters`);
  await requireAttempt(userId, attemptId);

  await db.transaction(async (tx) => {
    const draft = await lockedDraft(tx, attemptId);
    if (draft.submittedAt) throw new SubmissionLockedError();
    await tx.update(submissions).set({ text }).where(eq(submissions.id, draft.id));
  });
}

/** Adds uploaded files to the draft. One PDF, or up to 10 images, in total; not both. */
export async function addDraftFiles(
  userId: string,
  attemptId: string,
  files: { path: string; mime: string }[],
): Promise<void> {
  await requireAttempt(userId, attemptId);

  await db.transaction(async (tx) => {
    const draft = await lockedDraft(tx, attemptId);
    if (draft.submittedAt) throw new SubmissionLockedError();

    const existing = await tx
      .select()
      .from(submissionFiles)
      .where(eq(submissionFiles.submissionId, draft.id));
    const check = checkSheetFileSet([
      ...existing.map((file) => file.mime),
      ...files.map((file) => file.mime),
    ]);
    if (!check.ok) throw new WorkingFilesError(check.message);

    await tx.insert(submissionFiles).values(
      files.map((file, index) => ({
        submissionId: draft.id,
        path: file.path,
        mime: file.mime,
        position: existing.length + index,
      })),
    );
  });
}

/** Removes a file from a draft. Returns its storage path so the caller can delete the stored object. */
export async function removeDraftFile(userId: string, fileId: string): Promise<string> {
  const file = await requireSubmissionFile(userId, fileId);

  return db.transaction(async (tx) => {
    const [submission] = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, file.submissionId))
      .for("update");
    if (submission.submittedAt) throw new SubmissionLockedError();
    await tx.delete(submissionFiles).where(eq(submissionFiles.id, fileId));
    return file.path;
  });
}

/** Submits the attempt's working. Submitting twice changes nothing. */
export async function submitWorking(
  userId: string,
  attemptId: string,
): Promise<{ submissionId: string; alreadySubmitted: boolean }> {
  await requireAttempt(userId, attemptId);

  return db.transaction(async (tx) => {
    const [submission] = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.attemptId, attemptId))
      .for("update");
    if (!submission) throw new EmptyWorkingError();
    if (submission.submittedAt) return { submissionId: submission.id, alreadySubmitted: true };

    const files = await tx
      .select({ id: submissionFiles.id })
      .from(submissionFiles)
      .where(eq(submissionFiles.submissionId, submission.id));
    if ((submission.text ?? "").trim().length === 0 && files.length === 0)
      throw new EmptyWorkingError();

    await tx
      .update(submissions)
      .set({ submittedAt: new Date() })
      .where(eq(submissions.id, submission.id));
    return { submissionId: submission.id, alreadySubmitted: false };
  });
}

/**
 * Submits every draft of the user's on the sheet that has working. For each
 * question only the latest attempt counts. Returns the ids of the attempts
 * submitted; empty for a sheet that is not the user's.
 */
export async function submitAllDrafts(userId: string, sheetId: string): Promise<string[]> {
  const candidates = await db
    .select({ attemptId: attempts.id, questionId: attempts.questionId })
    .from(attempts)
    .innerJoin(questions, eq(attempts.questionId, questions.id))
    .innerJoin(submissions, eq(submissions.attemptId, attempts.id))
    .where(
      and(
        eq(attempts.userId, userId),
        eq(questions.sheetId, sheetId),
        isNull(submissions.submittedAt),
      ),
    )
    .orderBy(desc(attempts.startedAt));

  const latestPerQuestion = [
    ...new Map([...candidates].reverse().map((row) => [row.questionId, row])).values(),
  ];
  const submitted: string[] = [];
  for (const { attemptId } of latestPerQuestion) {
    try {
      const result = await submitWorking(userId, attemptId);
      if (!result.alreadySubmitted) submitted.push(attemptId);
    } catch (error) {
      if (!(error instanceof EmptyWorkingError)) throw error;
    }
  }
  return submitted;
}
