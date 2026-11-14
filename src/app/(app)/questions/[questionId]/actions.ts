"use server";

import { z } from "zod";

import {
  HintsNotReadyError,
  NoMoreHintsError,
  openAttemptFor,
  revealNextHintFor,
  startAttemptFor,
} from "@/db/queries/attempts";
import { requireUser } from "@/lib/auth/session";

const idSchema = z.string().min(1).max(100);

/** Idempotent: returns the open attempt for this question, creating it the first time. Call it from the browser, not while rendering. */
export async function openAttempt(input: {
  questionId: string;
  sessionId?: string;
}): Promise<{ attemptId: string }> {
  const user = await requireUser();
  const { questionId, sessionId } = z
    .object({ questionId: idSchema, sessionId: idSchema.optional() })
    .parse(input);
  return { attemptId: (await openAttemptFor(user.id, questionId, sessionId)).id };
}

/** Always a new attempt. "retry-now" keeps the hints already seen; "fresh" hides them. */
export async function startAttempt(input: {
  questionId: string;
  mode: "retry-now" | "fresh";
  sessionId?: string;
}): Promise<{ attemptId: string }> {
  const user = await requireUser();
  const { questionId, mode, sessionId } = z
    .object({
      questionId: idSchema,
      mode: z.enum(["retry-now", "fresh"]),
      sessionId: idSchema.optional(),
    })
    .parse(input);
  return { attemptId: (await startAttemptFor(user.id, questionId, mode, sessionId)).id };
}

export type RevealResult =
  { ok: true; level: 1 | 2 | 3; body: string } | { ok: false; error: string };

/** Reveals the next hint, strictly in order. */
export async function revealNextHint(input: { attemptId: string }): Promise<RevealResult> {
  const user = await requireUser();
  const { attemptId } = z.object({ attemptId: idSchema }).parse(input);
  try {
    return { ok: true, ...(await revealNextHintFor(user.id, attemptId)) };
  } catch (error) {
    if (error instanceof HintsNotReadyError || error instanceof NoMoreHintsError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
