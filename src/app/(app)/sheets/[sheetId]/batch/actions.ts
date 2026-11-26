"use server";

// Uploading working for several questions at once (SPEC-batch-working.md).

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import {
  BatchWorkingError,
  openBatchAttempts,
  submitBatchWorking,
  unusedWorkingKeys,
} from "@/db/queries/batch-working";
import { keyIsUnder } from "@/db/queries/sheets";
import { AiLimitError, DEMO_AI_LIMIT_MESSAGE, demoAiCallsLeft } from "@/lib/ai/budget";
import { orNotFound } from "@/lib/auth/guards";
import { requireSheet } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { MAX_BATCH_PHOTOS, MAX_CROPS_PER_QUESTION } from "@/lib/batch/regions";
import { mapLimit } from "@/lib/concurrency";
import { performMark } from "@/lib/pipeline/mark";
import { resolveMarkWithAi, startMarking } from "@/lib/pipeline/start-marking";
import {
  BatchProposalError,
  MATCH_FAILED_MESSAGE,
  proposeBatch,
  type BatchProposal,
} from "@/lib/pipeline/match-working";
import {
  ACCEPTED_IMAGE_MIMES,
  UploadRejectedError,
  deleteObject,
  verifyUploadedObject,
} from "@/lib/storage";
import { deleteBatchPhotos } from "@/lib/storage/batch-photos";

export type ProposeResult = { ok: true; proposal: BatchProposal } | { ok: false; error: string };
export type AttemptsResult =
  | { ok: true; attempts: { questionId: string; attemptId: string }[] }
  | { ok: false; error: string };
export type SubmitResult = { ok: true } | { ok: false; error: string };

const id = z.string().min(1).max(100);
const proposeSchema = z.object({
  sheetId: id,
  photoKeys: z.array(z.string().min(1).max(500)).min(1).max(MAX_BATCH_PHOTOS),
});

const questionIds = z.array(id).min(1).max(100);
const submitSchema = z.object({
  sheetId: id,
  /** The "Mark with AI now" switch; without it the sheet's last position is used. */
  markWithAi: z.boolean().optional(),
  questions: z
    .array(
      z.object({
        questionId: id,
        cropKeys: z.array(z.string().min(1).max(500)).min(1).max(MAX_CROPS_PER_QUESTION),
      }),
    )
    .min(1)
    .max(100),
});

/** The demo limit message when the user is a demo copy with fewer than `calls` AI calls left. */
async function demoRefusal(userId: string, calls: number): Promise<string | null> {
  const left = await demoAiCallsLeft(userId);
  return left !== null && left < calls ? DEMO_AI_LIMIT_MESSAGE : null;
}

/**
 * Asks the AI which part of which uploaded photo answers which question. Saves
 * nothing: the student checks the proposal on the review screen.
 */
export async function proposeBatchAction(input: {
  sheetId: string;
  photoKeys: string[];
}): Promise<ProposeResult> {
  const user = await requireUser();
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: `Choose between 1 and ${MAX_BATCH_PHOTOS} photos.` };
  const { sheetId, photoKeys } = parsed.data;
  await orNotFound(requireSheet(user.id, sheetId));

  if (new Set(photoKeys).size !== photoKeys.length)
    return { ok: false, error: "The same photo was sent twice." };
  if (!photoKeys.every((key) => keyIsUnder(key, user.id, "batch", sheetId)))
    return { ok: false, error: "Those photos were not uploaded for this sheet." };

  // The matching call, and at least one mark after it.
  const refusal = await demoRefusal(user.id, 2);
  if (refusal) return { ok: false, error: refusal };

  const photos: { key: string; mime: string }[] = [];
  try {
    for (const key of photoKeys) {
      const file = await verifyUploadedObject(user.id, key);
      if (!(ACCEPTED_IMAGE_MIMES as readonly string[]).includes(file.mime))
        return { ok: false, error: "Use JPEG, PNG or WebP photos." };
      photos.push({ key: file.key, mime: file.mime });
    }
  } catch (error) {
    if (error instanceof UploadRejectedError) return { ok: false, error: error.message };
    throw error;
  }

  try {
    return { ok: true, proposal: await proposeBatch(user.id, sheetId, photos) };
  } catch (error) {
    if (error instanceof BatchProposalError) return { ok: false, error: error.message };
    if (error instanceof AiLimitError) return { ok: false, error: DEMO_AI_LIMIT_MESSAGE };
    console.error(`matching batch working for sheet ${sheetId} failed`, error);
    return { ok: false, error: MATCH_FAILED_MESSAGE };
  }
}

/**
 * Opens (or creates) the attempt of each confirmed question, so the browser can upload
 * its crops with purpose `working`. Called on Submit and mark, not before, so a
 * cancelled review leaves no new attempts.
 */
export async function openBatchAttemptsAction(input: {
  sheetId: string;
  questionIds: string[];
}): Promise<AttemptsResult> {
  const user = await requireUser();
  const parsed = z.object({ sheetId: id, questionIds }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give at least one region to a question." };
  const { sheetId } = parsed.data;
  await orNotFound(requireSheet(user.id, sheetId));

  const refusal = await demoRefusal(user.id, parsed.data.questionIds.length);
  if (refusal) return { ok: false, error: refusal };
  try {
    return {
      ok: true,
      attempts: await openBatchAttempts(user.id, sheetId, parsed.data.questionIds),
    };
  } catch (error) {
    if (error instanceof BatchWorkingError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * Saves each confirmed question's crops (already uploaded to its attempt) after its
 * draft, submits them all, starts the marking five at a time, and deletes the
 * sheet's batch photos. Anything wrong saves nothing.
 */
export async function submitBatchAction(input: {
  sheetId: string;
  markWithAi?: boolean;
  questions: { questionId: string; cropKeys: string[] }[];
}): Promise<SubmitResult> {
  const user = await requireUser();
  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Give at least one region to a question." };
  const { sheetId, questions } = parsed.data;
  await orNotFound(requireSheet(user.id, sheetId));
  const keys = questions.flatMap((q) => q.cropKeys);
  const markWithAi = await resolveMarkWithAi(user.id, sheetId, parsed.data.markWithAi);

  // One mark for each question. Waiting makes no AI call, so it needs no calls to be left.
  const refusal = markWithAi ? await demoRefusal(user.id, questions.length) : null;
  if (refusal) return { ok: false, error: refusal };

  let submitted: { attemptId: string; submissionId: string }[];
  try {
    const confirmed = [];
    for (const q of questions) {
      const crops = [];
      for (const key of q.cropKeys) {
        const file = await verifyUploadedObject(user.id, key);
        crops.push({ key: file.key, mime: file.mime });
      }
      confirmed.push({ questionId: q.questionId, crops });
    }
    submitted = await submitBatchWorking(user.id, sheetId, confirmed);
  } catch (error) {
    if (!(error instanceof BatchWorkingError || error instanceof UploadRejectedError)) throw error;
    // Do not leave crops behind that nothing uses.
    const unused = await unusedWorkingKeys(user.id, keys);
    await Promise.all(unused.map((key) => deleteObject(key).catch(() => {})));
    return { ok: false, error: error.message };
  }

  const claims = await startMarking(
    submitted.map(({ submissionId }) => submissionId),
    markWithAi,
  );
  after(() => mapLimit(claims, 5, (claim) => performMark(claim)));
  await deleteBatchPhotos(user.id, sheetId).catch((error) =>
    console.error(`deleting batch photos of sheet ${sheetId} failed`, error),
  );
  revalidatePath(`/sheets/${sheetId}`);
  return { ok: true };
}

/** Discards the review: deletes every batch photo of the sheet. */
export async function cancelBatchAction(input: { sheetId: string }): Promise<void> {
  const user = await requireUser();
  const { sheetId } = z.object({ sheetId: id }).parse(input);
  await orNotFound(requireSheet(user.id, sheetId));
  await deleteBatchPhotos(user.id, sheetId);
}
