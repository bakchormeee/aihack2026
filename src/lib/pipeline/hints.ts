// Background job: write the three hints and the worked solution for each
// question of a sheet (task M4). Safe to run twice: only one run can save.

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { hints, questions, solutions } from "@/db/schema";
import { generateHints } from "@/lib/ai/generate-hints";
import { mapLimit } from "@/lib/concurrency";

export type HintsIo = { generate: typeof generateHints };

const defaultIo: HintsIo = { generate: generateHints };

/** How many questions are sent to the AI at once. */
export const HINTS_CONCURRENCY = 5;

export async function runHints(questionId: string, io: HintsIo = defaultIo): Promise<void> {
  const [question] = await db.select().from(questions).where(eq(questions.id, questionId));
  if (!question || question.hintsStatus !== "pending") return;

  try {
    const generated = await io.generate({ questionBody: question.body });

    await db.transaction(async (tx) => {
      // Claim the result: whichever run gets here first saves, the others stop.
      const claimed = await tx
        .update(questions)
        .set({ hintsStatus: "ready", hintsStatusUpdatedAt: new Date() })
        .where(and(eq(questions.id, questionId), eq(questions.hintsStatus, "pending")))
        .returning({ id: questions.id });
      if (claimed.length === 0) return;

      // Upserts, so that regenerating after an edit replaces the old text in place.
      await tx
        .insert(hints)
        .values(generated.hints.map((body, index) => ({ questionId, level: index + 1, body })))
        .onConflictDoUpdate({
          target: [hints.questionId, hints.level],
          set: { body: sql`excluded.body` },
        });
      await tx
        .insert(solutions)
        .values({ questionId, basis: "ai", body: generated.solution })
        .onConflictDoUpdate({
          target: [solutions.questionId, solutions.basis],
          set: { body: sql`excluded.body` },
        });
    });
  } catch (error) {
    console.error(`hints for question ${questionId} failed`, error);
    await db
      .update(questions)
      .set({ hintsStatus: "failed", hintsStatusUpdatedAt: new Date() })
      .where(and(eq(questions.id, questionId), eq(questions.hintsStatus, "pending")));
  }
}

/** Prepares every question of the sheet that is still pending. Never throws: a failed question is marked failed. */
export async function runHintsForSheet(sheetId: string, io: HintsIo = defaultIo): Promise<void> {
  const pending = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.sheetId, sheetId), eq(questions.hintsStatus, "pending")));
  await mapLimit(pending, HINTS_CONCURRENCY, (question) => runHints(question.id, io));
}
