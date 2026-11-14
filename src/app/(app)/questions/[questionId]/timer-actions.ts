"use server";

import { z } from "zod";

import { recordSecondsSpent, setDifficultyRating } from "@/db/queries/attempts";
import { requireUser } from "@/lib/auth/session";

const attemptSchema = z.object({ attemptId: z.string().min(1).max(100) });

/** Saves the time spent so far on the attempt. Never lowers a saved value. */
export async function saveSeconds(input: { attemptId: string; seconds: number }): Promise<void> {
  const user = await requireUser();
  const { attemptId, seconds } = attemptSchema
    .extend({ seconds: z.number().int().min(0) })
    .parse(input);
  await recordSecondsSpent(user.id, attemptId, seconds);
}

/** Saves the 1–5 difficulty rating, or clears it with null. */
export async function saveRating(input: {
  attemptId: string;
  rating: number | null;
}): Promise<void> {
  const user = await requireUser();
  const { attemptId, rating } = attemptSchema
    .extend({ rating: z.number().int().min(1).max(5).nullable() })
    .parse(input);
  await setDifficultyRating(user.id, attemptId, rating);
}
