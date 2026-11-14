"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { retrySummary } from "@/db/queries/history";
import { requireUser } from "@/lib/auth/session";

/** Clears a failed summary; the next page load writes it again. */
export async function retrySummaryAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  const id = z.string().min(1).max(100).parse(sheetId);
  await retrySummary(user.id, id);
  revalidatePath(`/sheets/${id}/summary`);
}
