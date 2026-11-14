"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { requeueHintsForSheet, requeueParse } from "@/db/queries/sheets";
import { requireUser } from "@/lib/auth/session";
import { runHintsForSheet } from "@/lib/pipeline/hints";
import { runSheetPipeline } from "@/lib/pipeline/sheet-job";

/** Runs the reading of a failed or stuck sheet again. Does nothing for any other sheet. */
export async function retryParseAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  if (await requeueParse(user.id, sheetId)) after(() => runSheetPipeline(sheetId));
  revalidatePath(`/sheets/${sheetId}`);
}

/** Writes the hints again for questions whose hints failed or got stuck. */
export async function retryHintsAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  if ((await requeueHintsForSheet(user.id, sheetId)) > 0) after(() => runHintsForSheet(sheetId));
  revalidatePath(`/sheets/${sheetId}`);
}
