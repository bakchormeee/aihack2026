"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { requeueParse } from "@/db/queries/sheets";
import { requireUser } from "@/lib/auth/session";
import { runParse } from "@/lib/pipeline/parse";

/** Runs the reading of a failed or stuck sheet again. Does nothing for any other sheet. */
export async function retryParseAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  if (await requeueParse(user.id, sheetId)) after(() => runParse(sheetId));
  revalidatePath(`/sheets/${sheetId}`);
}
