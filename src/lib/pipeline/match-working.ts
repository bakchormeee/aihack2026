// Proposing which part of which photo answers which question (SPEC-batch-working.md
// section 2). One AI call; nothing is saved. The student checks the proposal before
// anything is submitted.

import { getBatchQuestions } from "@/db/queries/batch-working";
import { withAiUser } from "@/lib/ai/budget";
import { matchWorking } from "@/lib/ai/match-working";
import { groupProposal, type Assignment, type Region } from "@/lib/batch/regions";
import { getObjectBytes } from "@/lib/storage";

export type MatchIo = {
  readFile: (key: string) => Promise<Buffer>;
  match: typeof matchWorking;
};

const defaultIo: MatchIo = { readFile: getObjectBytes, match: matchWorking };

export type BatchProposal = {
  /** One group per question, in the sheet's order; regions in reading order. */
  matched: Assignment[];
  unmatched: Region[];
  /** Questions that cannot take working (their latest attempt is submitted). */
  skipped: { questionId: string; label: string }[];
  /** The questions a region may be given to, in the sheet's order. */
  questions: { id: string; label: string; body: string }[];
};

/** Shown when the AI call fails; nothing is changed. */
export const MATCH_FAILED_MESSAGE =
  "The photos could not be read. Try again, or attach working on each question.";

/** A reason the student can act on; nothing was sent to the AI. */
export class BatchProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchProposalError";
  }
}

/**
 * Sends the photos (already verified: the user's own, images) and the questions that
 * can take working to the AI, and groups its regions by question. Throws NotFoundError
 * for a sheet that is not the user's, BatchProposalError when there is nothing to
 * match, and lets AI errors through (the caller shows its own message).
 */
export async function proposeBatch(
  userId: string,
  sheetId: string,
  photos: { key: string; mime: string }[],
  io: MatchIo = defaultIo,
): Promise<BatchProposal> {
  const { ready, questions } = await getBatchQuestions(userId, sheetId);
  if (!ready) throw new BatchProposalError("This sheet is not ready yet.");
  const eligible = questions.filter((q) => q.canTakeWorking);
  const skipped = questions
    .filter((q) => !q.canTakeWorking)
    .map((q) => ({ questionId: q.id, label: q.label }));
  if (eligible.length === 0)
    throw new BatchProposalError("Every question on this sheet already has submitted working.");
  if (photos.length === 0) throw new BatchProposalError("Choose at least one photo.");

  const files = await Promise.all(
    photos.map(async (photo) => ({ mime: photo.mime, data: await io.readFile(photo.key) })),
  );
  const raw = await withAiUser(userId, () =>
    io.match({
      photos: files,
      questions: eligible.map((q) => ({ label: q.label, body: q.body })),
    }),
  );
  const { matched, unmatched } = groupProposal(raw, eligible, photos.length);
  return {
    matched,
    unmatched,
    skipped,
    questions: eligible.map((q) => ({ id: q.id, label: q.label, body: q.body })),
  };
}
