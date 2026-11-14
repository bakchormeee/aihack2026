// Editing a parsed sheet (tasks M5 and M5b): label, topics, body, delete,
// merge and split. Every function takes the signed-in user's id and loads
// through the ownership helpers, so another user's ids give NotFoundError.
// Rules (SPEC.md, "Editable parse"): once a question has an attempt only its
// label and topics can change; a sheet that is not `ready` cannot be edited.

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { attempts, questionTopics, questions, sheets, topics } from "@/db/schema";
import { NotFoundError, requireQuestion, requireSheet } from "@/lib/auth/ownership";

export const MAX_TOPICS_PER_QUESTION = 3;

/** A rule of the editor was broken (not a missing row, which is NotFoundError). */
export class EditRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditRuleError";
  }
}

export const labelSchema = z.string().trim().min(1, "Give the question a label.").max(40);
export const bodySchema = z.string().trim().min(1, "The question text cannot be empty.").max(20000);
export const topicNamesSchema = z
  .array(z.string().trim().min(1).max(80))
  .min(1, "Pick at least one topic.")
  .max(MAX_TOPICS_PER_QUESTION, `Use at most ${MAX_TOPICS_PER_QUESTION} topics.`);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The course's topics, for the editor's picker. Empty unless the sheet is the user's. */
export async function listCourseTopics(userId: string, sheetId: string) {
  const sheet = await requireSheet(userId, sheetId);
  return db
    .select({ id: topics.id, name: topics.name })
    .from(topics)
    .where(eq(topics.courseId, sheet.courseId))
    .orderBy(asc(topics.name));
}

/** Question ids (of the given ones) that have at least one attempt. */
export async function attemptedQuestionIds(questionIds: string[]): Promise<Set<string>> {
  if (questionIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ id: attempts.questionId })
    .from(attempts)
    .where(inArray(attempts.questionId, questionIds));
  return new Set(rows.map((row) => row.id));
}

async function assertReady(tx: Tx, sheetId: string | null) {
  if (!sheetId) throw new EditRuleError("This question is not part of a sheet.");
  const [sheet] = await tx
    .select({ status: sheets.status })
    .from(sheets)
    .where(eq(sheets.id, sheetId));
  if (sheet?.status !== "ready") throw new EditRuleError("The sheet is not ready to edit yet.");
}

/** Checks ownership (outside the transaction: the helpers use the shared client). */
async function owned(userId: string, ...questionIds: string[]) {
  for (const id of questionIds) await requireQuestion(userId, id);
}

/** Re-reads the question locked for update, so an attempt cannot slip in between check and change. */
async function lockQuestion(tx: Tx, questionId: string) {
  const [question] = await tx
    .select()
    .from(questions)
    .where(eq(questions.id, questionId))
    .for("update");
  if (!question) throw new NotFoundError();
  await assertReady(tx, question.sheetId);
  return question;
}

async function assertUnattempted(tx: Tx, questionIds: string[], what: string) {
  const rows = await tx
    .select({ id: attempts.id })
    .from(attempts)
    .where(inArray(attempts.questionId, questionIds))
    .limit(1);
  if (rows.length > 0) {
    throw new EditRuleError(`This question has been attempted, so it cannot be ${what}.`);
  }
}

/** Finds each topic of the course by name, ignoring case, creating the missing ones. */
async function resolveTopicIds(tx: Tx, courseId: string, names: string[]): Promise<string[]> {
  const unique: string[] = [];
  for (const name of names) {
    if (!unique.some((other) => other.toLowerCase() === name.toLowerCase())) unique.push(name);
  }
  const existing = await tx.select().from(topics).where(eq(topics.courseId, courseId));
  const ids: string[] = [];
  for (const name of unique) {
    let match = existing.find((topic) => topic.name.toLowerCase() === name.toLowerCase());
    if (!match) {
      await tx.insert(topics).values({ courseId, name }).onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(topics)
        .where(
          and(eq(topics.courseId, courseId), sql`lower(${topics.name}) = ${name.toLowerCase()}`),
        );
      match = row;
      existing.push(row);
    }
    ids.push(match.id);
  }
  return ids;
}

async function renumber(tx: Tx, sheetId: string) {
  const rows = await tx
    .select({ id: questions.id, position: questions.position })
    .from(questions)
    .where(eq(questions.sheetId, sheetId))
    .orderBy(asc(questions.position));
  for (const [index, row] of rows.entries()) {
    if (row.position !== index + 1) {
      await tx
        .update(questions)
        .set({ position: index + 1 })
        .where(eq(questions.id, row.id));
    }
  }
}

/** Changes label and topics (by name; unknown names become new topics). Allowed after attempts. */
export async function updateLabelAndTopics(
  userId: string,
  questionId: string,
  input: { label: string; topicNames: string[] },
) {
  const label = labelSchema.parse(input.label);
  const names = topicNamesSchema.parse(input.topicNames);
  await owned(userId, questionId);
  await db.transaction(async (tx) => {
    const question = await lockQuestion(tx, questionId);
    const topicIds = await resolveTopicIds(tx, question.courseId, names);
    await tx.update(questions).set({ label }).where(eq(questions.id, questionId));
    await tx.delete(questionTopics).where(eq(questionTopics.questionId, questionId));
    await tx.insert(questionTopics).values(topicIds.map((topicId) => ({ questionId, topicId })));
  });
}

/** Changes the body and resets the hints to `pending`. The caller then runs `runHints`. */
export async function updateBody(userId: string, questionId: string, body: string) {
  const text = bodySchema.parse(body);
  await owned(userId, questionId);
  await db.transaction(async (tx) => {
    await lockQuestion(tx, questionId);
    await assertUnattempted(tx, [questionId], "edited");
    await tx
      .update(questions)
      .set({ body: text, hintsStatus: "pending", hintsStatusUpdatedAt: new Date() })
      .where(eq(questions.id, questionId));
  });
}

export async function deleteQuestion(userId: string, questionId: string) {
  await owned(userId, questionId);
  await db.transaction(async (tx) => {
    const question = await lockQuestion(tx, questionId);
    await assertUnattempted(tx, [questionId], "deleted");
    await tx.delete(questions).where(eq(questions.id, questionId));
    await renumber(tx, question.sheetId!);
  });
}
