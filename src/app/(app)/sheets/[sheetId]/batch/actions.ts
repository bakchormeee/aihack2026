"use server";

// Uploading working for several questions at once (SPEC-batch-working.md).

import { z } from "zod";

import { keyIsUnder } from "@/db/queries/sheets";
import { AiLimitError, DEMO_AI_LIMIT_MESSAGE, demoAiCallsLeft } from "@/lib/ai/budget";
import { orNotFound } from "@/lib/auth/guards";
import { requireSheet } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { MAX_BATCH_PHOTOS } from "@/lib/batch/regions";
import {
  BatchProposalError,
  MATCH_FAILED_MESSAGE,
  proposeBatch,
  type BatchProposal,
} from "@/lib/pipeline/match-working";
import { ACCEPTED_IMAGE_MIMES, UploadRejectedError, verifyUploadedObject } from "@/lib/storage";

export type ProposeResult = { ok: true; proposal: BatchProposal } | { ok: false; error: string };

const id = z.string().min(1).max(100);
const proposeSchema = z.object({
  sheetId: id,
  photoKeys: z.array(z.string().min(1).max(500)).min(1).max(MAX_BATCH_PHOTOS),
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
