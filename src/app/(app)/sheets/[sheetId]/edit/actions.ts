"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import {
  EditRuleError,
  bodySchema,
  deleteQuestion,
  labelSchema,
  mergeQuestions,
  splitQuestion,
  topicNamesSchema,
  updateBody,
  updateLabelAndTopics,
} from "@/db/queries/question-edit";
import { NotFoundError, requireQuestion } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { runHints } from "@/lib/pipeline/hints";

export type EditResult = { ok: true } | { ok: false; error: string };

const id = z.string().min(1).max(100);

/** Runs one edit as the signed-in user and turns rule errors into a message. */
async function run(
  questionId: string,
  work: (userId: string) => Promise<string[]>,
): Promise<EditResult> {
  const user = await requireUser();
  try {
    const { sheetId } = await requireQuestion(user.id, questionId);
    const regenerate = await work(user.id);
    for (const hintId of regenerate) after(() => runHints(hintId));
    if (sheetId) {
      revalidatePath(`/sheets/${sheetId}`);
      revalidatePath(`/sheets/${sheetId}/edit`);
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof EditRuleError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError)
      return { ok: false, error: error.issues[0]?.message ?? "Check the input." };
    throw error;
  }
}

const detailsInput = z.object({ questionId: id, label: labelSchema, topicNames: topicNamesSchema });

export async function saveDetailsAction(input: unknown): Promise<EditResult> {
  const parsed = detailsInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the input." };
  const { questionId, label, topicNames } = parsed.data;
  return run(questionId, async (userId) => {
    await updateLabelAndTopics(userId, questionId, { label, topicNames });
    return [];
  });
}

const bodyInput = z.object({ questionId: id, body: bodySchema });

export async function saveBodyAction(input: unknown): Promise<EditResult> {
  const parsed = bodyInput.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the input." };
  const { questionId, body } = parsed.data;
  return run(questionId, async (userId) => {
    await updateBody(userId, questionId, body);
    return [questionId];
  });
}

export async function deleteQuestionAction(input: unknown): Promise<EditResult> {
  const parsed = z.object({ questionId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the input." };
  const { questionId } = parsed.data;
  return run(questionId, async (userId) => {
    await deleteQuestion(userId, questionId);
    return [];
  });
}

export async function mergeQuestionsAction(input: unknown): Promise<EditResult> {
  const parsed = z.object({ firstId: id, secondId: id }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the input." };
  const { firstId, secondId } = parsed.data;
  return run(firstId, async (userId) => [await mergeQuestions(userId, firstId, secondId)]);
}

export async function splitQuestionAction(input: unknown): Promise<EditResult> {
  const parsed = z.object({ questionId: id, index: z.number().int().min(1) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a point inside the question text." };
  const { questionId, index } = parsed.data;
  return run(questionId, async (userId) => [...(await splitQuestion(userId, questionId, index))]);
}
