"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { requeueHintsForSheet, requeueParse, setTimerEnabled } from "@/db/queries/sheets";
import { submitAllDrafts } from "@/db/queries/working";
import { demoAiRefusal } from "@/lib/ai/budget";
import { requireUser } from "@/lib/auth/session";
import { mapLimit } from "@/lib/concurrency";
import { runHintsForSheet } from "@/lib/pipeline/hints";
import { orNotFound } from "@/lib/auth/guards";
import { requireSheet } from "@/lib/auth/ownership";
import { parseSwitch } from "@/lib/marking/plan";
import { performMark } from "@/lib/pipeline/mark";
import { resolveMarkWithAi, startMarking } from "@/lib/pipeline/start-marking";
import { runSheetPipeline } from "@/lib/pipeline/sheet-job";

/** Runs the reading of a failed or stuck sheet again. Does nothing for any other sheet. */
export async function retryParseAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  if (await demoAiRefusal(user.id)) return; // a demo copy at its AI limit: nothing starts
  if (await requeueParse(user.id, sheetId)) after(() => runSheetPipeline(sheetId));
  revalidatePath(`/sheets/${sheetId}`);
}

/** Writes the hints again for questions whose hints failed or got stuck. */
export async function retryHintsAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  if (await demoAiRefusal(user.id)) return; // a demo copy at its AI limit: nothing starts
  if ((await requeueHintsForSheet(user.id, sheetId)) > 0) after(() => runHintsForSheet(sheetId));
  revalidatePath(`/sheets/${sheetId}`);
}

/** Switches the sheet's timer on or off. */
export async function setTimerAction(sheetId: string, enabled: boolean): Promise<void> {
  const user = await requireUser();
  await setTimerEnabled(user.id, sheetId, enabled);
  revalidatePath(`/sheets/${sheetId}`);
}

/**
 * Submits every question's working that is still a draft. Each is then marked by the marking
 * plan (official solution at once, the AI five at a time, or waiting when "Mark with AI now" is
 * off). The form may send `markWithAi`; without it the sheet's last position is used.
 */
export async function submitAllAction(sheetId: string, formData?: FormData): Promise<void> {
  const user = await requireUser();
  const sheet = await orNotFound(requireSheet(user.id, sheetId));
  const markWithAi = await resolveMarkWithAi(
    user.id,
    sheet.id,
    parseSwitch(formData?.get("markWithAi")),
  );
  // Waiting makes no AI call, so a demo copy at its limit may still submit.
  if (markWithAi && (await demoAiRefusal(user.id))) return; // nothing starts
  const submitted = await submitAllDrafts(user.id, sheetId);
  const claims = await startMarking(
    submitted.map(({ submissionId }) => submissionId),
    markWithAi,
  );
  after(() => mapLimit(claims, 5, (claim) => performMark(claim)));
  revalidatePath(`/sheets/${sheetId}`);
}
