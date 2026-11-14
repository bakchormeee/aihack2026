"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { checkSheetFileSet, keyIsUnder } from "@/db/queries/sheets";
import { NotFoundError, requireSheet } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import {
  performOfficialRemark,
  restartOfficialRemark,
  startOfficialSolutions,
} from "@/lib/pipeline/remark";
import { UploadRejectedError, verifyUploadedObject } from "@/lib/storage";

const inputSchema = z.object({
  sheetId: z.string().min(1),
  files: z
    .array(z.object({ key: z.string().min(1) }))
    .min(1)
    .max(10),
});

export type UploadSolutionsResult = { error: string } | { ok: true };

/** Saves the uploaded official solutions and starts reading them and marking again. */
export async function uploadSolutionsAction(
  input: z.input<typeof inputSchema>,
): Promise<UploadSolutionsResult> {
  const user = await requireUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };
  const { sheetId, files } = parsed.data;

  try {
    await requireSheet(user.id, sheetId);
  } catch (error) {
    if (error instanceof NotFoundError) return { error: "Sheet not found." };
    throw error;
  }
  if (!files.every((file) => keyIsUnder(file.key, user.id, "official_solutions", sheetId))) {
    return { error: "Those files were not uploaded for this sheet." };
  }

  const verified = [];
  try {
    for (const file of files) verified.push(await verifyUploadedObject(user.id, file.key));
  } catch (error) {
    if (error instanceof UploadRejectedError) return { error: error.message };
    throw error;
  }
  const set = checkSheetFileSet(verified.map((file) => file.mime));
  if (!set.ok) return { error: set.message };

  const started = await startOfficialSolutions(
    user.id,
    sheetId,
    verified.map((file) => ({ path: file.key, mime: file.mime })),
  );
  if (!started) return { error: "The solutions are already being processed. Please wait." };
  after(() => performOfficialRemark(sheetId));
  revalidatePath(`/sheets/${sheetId}/solutions`);
  return { ok: true };
}

/** Runs a failed or stuck job again with the files already uploaded. */
export async function retryRemarkAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  if (await restartOfficialRemark(user.id, sheetId)) after(() => performOfficialRemark(sheetId));
  revalidatePath(`/sheets/${sheetId}/solutions`);
}
