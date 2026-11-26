// What the "Mark with AI now" switch needs to know (SPEC-study-views.md, mark-on-official).

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { solutions } from "@/db/schema";

/** The ids, among `questionIds`, of the questions that have an official solution. */
export async function officialQuestionIds(questionIds: string[]): Promise<string[]> {
  if (questionIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ questionId: solutions.questionId })
    .from(solutions)
    .where(and(eq(solutions.basis, "official"), inArray(solutions.questionId, questionIds)));
  return rows.map((row) => row.questionId);
}
