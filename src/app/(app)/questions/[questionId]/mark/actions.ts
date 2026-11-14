"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

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
