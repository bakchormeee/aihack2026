"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { DisputeRefusedError, startDispute } from "@/db/queries/marking";
import {
  NoMoreHintsError,
  HintsNotReadyError,
  revealNextHintFor,
  startAttemptFor,
} from "@/db/queries/attempts";
import { getWorkingFor } from "@/db/queries/working";
import { demoAiRefusal } from "@/lib/ai/budget";
import { NotFoundError, requireAttempt } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { claimMark, performMark } from "@/lib/pipeline/mark";

/** Runs the marking again for a submission whose mark failed or got stuck. Does nothing otherwise. */
export async function retryMarkAction(questionId: string, attemptId: string): Promise<void> {
  const user = await requireUser();
  if (await demoAiRefusal(user.id)) return; // a demo copy at its AI limit: nothing starts
  const work = await getWorkingFor(user.id, attemptId);
  if (work.submissionId && work.submittedAt) {
    const claim = await claimMark({ submissionId: work.submissionId, basis: "ai" });
    if (claim) after(() => performMark(claim));
  }
  revalidatePath(`/questions/${questionId}`);
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

export type DisputeResult = { error?: string };

/** "I think this is right": marks the attempt again, with the optional reason, keeping the earlier marks. */
export async function disputeAction(
  questionId: string,
  attemptId: string,
  _previous: DisputeResult,
  formData: FormData,
): Promise<DisputeResult> {
  const user = await requireUser();
  const raw = formData.get("reason");
  const reason = typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
  const refusal = await demoAiRefusal(user.id);
  if (refusal) return { error: refusal };
  try {
    // The attempt must belong to this question as well as to the user.
    const attempt = await requireAttempt(user.id, attemptId);
    if (attempt.questionId !== questionId) return { error: "Attempt not found." };
    const claim = await startDispute(user.id, attemptId, reason);
    after(() => performMark(claim));
  } catch (error) {
    if (error instanceof DisputeRefusedError) return { error: error.message };
    if (error instanceof NotFoundError) return { error: "Attempt not found." };
    throw error;
  }
  revalidatePath(`/questions/${questionId}`);
  return {};
}
