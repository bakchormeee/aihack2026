// Working for several questions at once (SPEC-batch-working.md): which questions of a
// sheet can take working, and submitting the crops the student confirmed.

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { attempts, questions, submissionFiles, submissions } from "@/db/schema";
import { requireSheet } from "@/lib/auth/ownership";
import { MAX_CROPS_PER_QUESTION } from "@/lib/batch/regions";
import { ACCEPTED_IMAGE_MIMES } from "@/lib/storage/limits";

import { openAttemptFor } from "./attempts";
import { checkSheetFileSet, keyIsUnder } from "./sheets";

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

/** Something the student confirmed cannot be saved; nothing was saved. */
export class BatchWorkingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchWorkingError";
  }
}

const CANNOT_TAKE_WORKING = "A region was given to a question that cannot take working.";
const NOT_UPLOADED_FOR_QUESTION = "A crop was not uploaded for its question.";

async function readyQuestions(userId: string, sheetId: string, questionIds: readonly string[]) {
  const { ready, questions: states } = await getBatchQuestions(userId, sheetId);
  if (!ready) throw new BatchWorkingError("This sheet is not ready yet.");
  if (questionIds.length === 0)
    throw new BatchWorkingError("Give at least one region to a question.");
  if (new Set(questionIds).size !== questionIds.length)
    throw new BatchWorkingError("A question was given twice.");
  return questionIds.map((id) => {
    const state = states.find((q) => q.id === id);
    if (!state?.canTakeWorking) throw new BatchWorkingError(CANNOT_TAKE_WORKING);
    return state;
  });
}

/**
 * The attempt each confirmed question's crops are uploaded to: its open attempt, or a
 * new one with no hints revealed and no time recorded (openAttemptFor). Every
 * question must be on the sheet and able to take working.
 */
export async function openBatchAttempts(
  userId: string,
  sheetId: string,
  questionIds: readonly string[],
): Promise<{ questionId: string; attemptId: string }[]> {
  const states = await readyQuestions(userId, sheetId, questionIds);
  const opened = [];
  for (const state of states) {
    const attempt = await openAttemptFor(userId, state.id);
    opened.push({ questionId: state.id, attemptId: attempt.id });
  }
  return opened;
}

export type ConfirmedQuestion = {
  questionId: string;
  /** The crops in order, already checked to exist in storage (verifyUploadedObject). */
  crops: { key: string; mime: string }[];
};

/**
 * Adds each question's crops after the existing content of its draft (typed text and
 * files are kept) and submits it, all in one transaction: if anything is wrong,
 * nothing is saved. Returns the submissions to mark.
 */
export async function submitBatchWorking(
  userId: string,
  sheetId: string,
  confirmed: readonly ConfirmedQuestion[],
): Promise<{ attemptId: string; submissionId: string }[]> {
  await readyQuestions(
    userId,
    sheetId,
    confirmed.map((c) => c.questionId),
  );
  const keys = confirmed.flatMap((c) => c.crops.map((crop) => crop.key));
  if (new Set(keys).size !== keys.length) throw new BatchWorkingError("A crop was sent twice.");
  for (const c of confirmed) {
    if (c.crops.length === 0)
      throw new BatchWorkingError("Each question needs at least one region.");
    if (c.crops.length > MAX_CROPS_PER_QUESTION)
      throw new BatchWorkingError("A question can have at most 10 regions.");
    if (c.crops.some((crop) => !(ACCEPTED_IMAGE_MIMES as readonly string[]).includes(crop.mime)))
      throw new BatchWorkingError("Each crop must be a JPEG, PNG or WebP image.");
  }

  return db.transaction(async (tx) => {
    const states = await sheetQuestionStates(tx, userId, sheetId);
    // A crop is a new upload: a key some submission already uses is refused.
    const used = await tx
      .select({ path: submissionFiles.path })
      .from(submissionFiles)
      .where(inArray(submissionFiles.path, keys));
    if (used.length > 0) throw new BatchWorkingError(NOT_UPLOADED_FOR_QUESTION);

    const submitted: { attemptId: string; submissionId: string }[] = [];
    for (const c of confirmed) {
      const state = states.find((q) => q.id === c.questionId);
      const attemptId = state?.latestAttemptId;
      if (!state?.canTakeWorking || !attemptId) throw new BatchWorkingError(CANNOT_TAKE_WORKING);
      if (!c.crops.every((crop) => keyIsUnder(crop.key, userId, "working", attemptId)))
        throw new BatchWorkingError(NOT_UPLOADED_FOR_QUESTION);

      await tx.insert(submissions).values({ attemptId }).onConflictDoNothing();
      const [draft] = await tx
        .select()
        .from(submissions)
        .where(eq(submissions.attemptId, attemptId))
        .for("update");
      if (draft.submittedAt) throw new BatchWorkingError(CANNOT_TAKE_WORKING);

      const existing = await tx
        .select({ mime: submissionFiles.mime })
        .from(submissionFiles)
        .where(eq(submissionFiles.submissionId, draft.id));
      const check = checkSheetFileSet([
        ...existing.map((file) => file.mime),
        ...c.crops.map((crop) => crop.mime),
      ]);
      if (!check.ok)
        throw new BatchWorkingError(
          `Question ${state.label} cannot take these crops: ${check.message}`,
        );

      await tx.insert(submissionFiles).values(
        c.crops.map((crop, index) => ({
          submissionId: draft.id,
          path: crop.key,
          mime: crop.mime,
          position: existing.length + index,
        })),
      );
      await tx
        .update(submissions)
        .set({ submittedAt: new Date() })
        .where(eq(submissions.id, draft.id));
      submitted.push({ attemptId, submissionId: draft.id });
    }
    return submitted;
  });
}

/** The keys under the user's own working folder that no submission uses (safe to delete). */
export async function unusedWorkingKeys(
  userId: string,
  keys: readonly string[],
): Promise<string[]> {
  const own = keys.filter((key) => key.startsWith(`u/${userId}/working/`) && !key.includes(".."));
  if (own.length === 0) return [];
  const used = await db
    .select({ path: submissionFiles.path })
    .from(submissionFiles)
    .where(inArray(submissionFiles.path, own));
  const usedPaths = new Set(used.map((row) => row.path));
  return own.filter((key) => !usedPaths.has(key));
}
