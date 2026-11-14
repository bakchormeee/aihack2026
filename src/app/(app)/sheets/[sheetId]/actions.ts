"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { requeueHintsForSheet, requeueParse, setTimerEnabled } from "@/db/queries/sheets";
import { submitAllDrafts } from "@/db/queries/working";
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

/** Switches the sheet's timer on or off. */
export async function setTimerAction(sheetId: string, enabled: boolean): Promise<void> {
  const user = await requireUser();
  await setTimerEnabled(user.id, sheetId, enabled);
  revalidatePath(`/sheets/${sheetId}`);
}

/** Submits every question's working that is still a draft. The marks are started by task M9. */
export async function submitAllAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  await submitAllDrafts(user.id, sheetId);
  revalidatePath(`/sheets/${sheetId}`);
}
