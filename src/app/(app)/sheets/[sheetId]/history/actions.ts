"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { startAttemptFor } from "@/db/queries/attempts";
import { requireUser } from "@/lib/auth/session";

/** "Try again": a fresh attempt with every hint hidden, then the question screen. */
export async function tryAgainAction(questionId: string): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).max(100).parse(questionId);
  await startAttemptFor(user.id, id, "fresh");
  redirect(`/questions/${id}`);
}
