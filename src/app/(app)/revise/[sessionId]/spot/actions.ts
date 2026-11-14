"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { NotFoundError } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { answerSpotItem } from "@/lib/pipeline/spot-answer";

const inputSchema = z.object({
  sessionId: z.string().min(1).max(100),
  position: z.number().int().min(1).max(100),
  noError: z.boolean(),
  ticked: z.array(z.object({ line: z.number().int(), explanation: z.string().max(2000) })).max(30),
});

export type SpotAnswerActionResult = { ok: true } | { ok: false; error: string };

/** Submits the answer to one spot-the-error question and judges it. */
export async function submitSpotAnswerAction(
  input: z.input<typeof inputSchema>,
): Promise<SpotAnswerActionResult> {
  const user = await requireUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid answer." };

  try {
    const result = await answerSpotItem(user.id, parsed.data.sessionId, parsed.data.position, {
      noError: parsed.data.noError,
      ticked: parsed.data.ticked,
    });
    if (!result.ok) return result;
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "Question not found." };
    throw error;
  }
  revalidatePath(`/revise/${parsed.data.sessionId}`, "layout");
  return { ok: true };
}
