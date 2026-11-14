"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import {
  NoMoreHintsError,
  HintsNotReadyError,
  revealNextHintFor,
  startAttemptFor,
} from "@/db/queries/attempts";
import { getWorkingFor } from "@/db/queries/working";
import { requireUser } from "@/lib/auth/session";
import { claimMark, performMark } from "@/lib/pipeline/mark";

/** Runs the marking again for a submission whose mark failed or got stuck. Does nothing otherwise. */
export async function retryMarkAction(questionId: string, attemptId: string): Promise<void> {
  const user = await requireUser();
  const work = await getWorkingFor(user.id, attemptId);
  if (work.submissionId && work.submittedAt) {
    const claim = await claimMark({ submissionId: work.submissionId, basis: "ai" });
    if (claim) after(() => performMark(claim));
  }
  revalidatePath(`/questions/${questionId}/mark`);
}

const questionHref = (questionId: string, sessionId?: string) =>
  `/questions/${questionId}${sessionId ? `?session=${sessionId}` : ""}`;

/** Starts a new attempt that keeps the hints already seen, and opens the question. The earlier attempt is unchanged. */
export async function retryNowAction(questionId: string, sessionId?: string): Promise<void> {
  const user = await requireUser();
  await startAttemptFor(user.id, questionId, "retry-now", sessionId);
  redirect(questionHref(questionId, sessionId));
}

/** Like retry now, and also shows the next hint in the new attempt. */
export async function retryWithNextHintAction(
  questionId: string,
  sessionId?: string,
): Promise<void> {
  const user = await requireUser();
  const attempt = await startAttemptFor(user.id, questionId, "retry-now", sessionId);
  try {
    await revealNextHintFor(user.id, attempt.id);
  } catch (error) {
    // No hint left, or hints not ready: the retry still starts, just without a new hint.
    if (!(error instanceof NoMoreHintsError || error instanceof HintsNotReadyError)) throw error;
  }
  redirect(questionHref(questionId, sessionId));
}
