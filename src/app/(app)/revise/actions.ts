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
import { createSpotSession } from "@/db/queries/spot";
import { demoAiRefusal } from "@/lib/ai/budget";
import { NotFoundError, requireRevisionSession } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { buildRevisionSession } from "@/lib/pipeline/revision";
import { buildSpotSession } from "@/lib/pipeline/spot-session";
import { SPOT_QUESTION_COUNTS } from "@/lib/domain";

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
  const refusal = await demoAiRefusal(user.id);
  if (refusal) return { error: refusal };

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

const spotInputSchema = z.object({
  courseId: z.string().min(1),
  questionCount: z.union(
    SPOT_QUESTION_COUNTS.map((n) => z.literal(n)) as [
      z.ZodLiteral<5>,
      z.ZodLiteral<10>,
      z.ZodLiteral<15>,
    ],
  ),
  topicIds: z.array(z.string().min(1)).max(200),
});

/** Creates a spot-the-error session, writes it after the response, and opens it. Redirects on success. */
export async function startSpotSessionAction(
  input: z.input<typeof spotInputSchema>,
): Promise<StartRevisionResult> {
  const user = await requireUser();
  const parsed = spotInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };
  const refusal = await demoAiRefusal(user.id);
  if (refusal) return { error: refusal };

  let sessionId: string;
  try {
    const session = await createSpotSession(user.id, parsed.data);
    sessionId = session.id;
  } catch (error) {
    if (error instanceof NoCandidatesError) {
      return {
        error:
          "There are no common errors to practise yet for this choice. Get some work marked first.",
      };
    }
    if (error instanceof NotFoundError) return { error: "Course or topic not found." };
    throw error;
  }
  // Writing the exercises takes a while, so it runs after the response is sent.
  after(() => buildSpotSession(sessionId));
  redirect(`/revise/${sessionId}`);
}

/** Builds a failed or stuck session again, with the builder for its kind. */
export async function retryRevisionAction(sessionId: string): Promise<void> {
  const user = await requireUser();
  if (await demoAiRefusal(user.id)) return; // a demo copy at its AI limit: nothing starts
  const session = await requireRevisionSession(user.id, sessionId);
  if (await requeueRevisionSession(user.id, sessionId)) {
    after(() =>
      session.mode === "spot_error" ? buildSpotSession(sessionId) : buildRevisionSession(sessionId),
    );
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
