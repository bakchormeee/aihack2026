"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import {
  createRevisionSession,
  NoCandidatesError,
  requeueRevisionSession,
} from "@/db/queries/revision";
import { hideMisconception } from "@/db/queries/misconceptions";
import { NotFoundError } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { buildRevisionSession } from "@/lib/pipeline/revision";

const inputSchema = z.object({
  courseId: z.string().min(1),
  targetMinutes: z.union([z.literal(20), z.literal(45), z.literal(90)]),
  topicIds: z.array(z.string().min(1)).max(200),
});

export type StartRevisionResult = { error: string };

/** Creates the session, builds it after the response, and opens it. Redirects on success. */
export async function startRevisionAction(
  input: z.input<typeof inputSchema>,
): Promise<StartRevisionResult> {
  const user = await requireUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };

  let sessionId: string;
  try {
    const session = await createRevisionSession(user.id, {
      courseId: parsed.data.courseId,
      targetMinutes: parsed.data.targetMinutes,
      topicIds: parsed.data.topicIds.length > 0 ? parsed.data.topicIds : null,
    });
    sessionId = session.id;
  } catch (error) {
    if (error instanceof NoCandidatesError) {
      return { error: "There is nothing to revise yet for this choice. Mark some work first." };
    }
    if (error instanceof NotFoundError) return { error: "Course or topic not found." };
    throw error;
  }
  // Writing the variants takes a while, so it runs after the response is sent.
  after(() => buildRevisionSession(sessionId));
  redirect(`/revise/${sessionId}`);
}

/** Builds a failed or stuck session again. */
export async function retryRevisionAction(sessionId: string): Promise<void> {
  const user = await requireUser();
  if (await requeueRevisionSession(user.id, sessionId)) {
    after(() => buildRevisionSession(sessionId));
  }
  revalidatePath(`/revise/${sessionId}`);
}

/** "Not me": hides a misconception so it is never planted or shown again. */
export async function hideMisconceptionAction(misconceptionId: string): Promise<void> {
  const user = await requireUser();
  try {
    await hideMisconception(user.id, misconceptionId);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  revalidatePath("/revise");
}
