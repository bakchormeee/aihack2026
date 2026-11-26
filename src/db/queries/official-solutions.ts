// The official solutions of a sheet, for its Solutions tab (one per question, in sheet order).
// The student uploaded them, so they are shown whatever the unlock rule of the question page.

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { questions, sheetFiles, solutions } from "@/db/schema";
import { requireSheet } from "@/lib/auth/ownership";

export type OfficialSolutionRow = {
  id: string;
  label: string;
  body: string;
  /** The official solution, or null when the uploaded document has none for this question. */
  solution: string | null;
};

export async function getOfficialSolutions(
  userId: string,
  sheetId: string,
): Promise<{ questions: OfficialSolutionRow[]; files: { id: string; mime: string }[] }> {
  await requireSheet(userId, sheetId);
  const sheetQuestions = await db
    .select({ id: questions.id, label: questions.label, body: questions.body })
    .from(questions)
    .where(eq(questions.sheetId, sheetId))
    .orderBy(asc(questions.position));
  const official = sheetQuestions.length
    ? await db
        .select({ questionId: solutions.questionId, body: solutions.body })
        .from(solutions)
        .where(
          and(
            eq(solutions.basis, "official"),
            inArray(
              solutions.questionId,
              sheetQuestions.map((q) => q.id),
            ),
          ),
        )
    : [];
  const byQuestion = new Map(official.map((row) => [row.questionId, row.body]));
  const files = await db
    .select({ id: sheetFiles.id, mime: sheetFiles.mime })
    .from(sheetFiles)
    .where(and(eq(sheetFiles.sheetId, sheetId), eq(sheetFiles.kind, "official_solutions")))
    .orderBy(asc(sheetFiles.position));
  return {
    questions: sheetQuestions.map((q) => ({ ...q, solution: byQuestion.get(q.id) ?? null })),
    files,
  };
}
