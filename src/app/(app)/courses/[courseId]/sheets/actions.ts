"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  checkSheetFileSet,
  createSheetWithFiles,
  keyIsUnder,
  titleFromFileName,
} from "@/db/queries/sheets";
import { demoAiRefusal } from "@/lib/ai/budget";
import { NotFoundError, requireCourse } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";
import { runSheetPipeline } from "@/lib/pipeline/sheet-job";
import { UploadRejectedError, verifyUploadedObject } from "@/lib/storage";

const inputSchema = z.object({
  courseId: z.string().min(1),
  title: z.string().max(150),
  files: z
    .array(z.object({ key: z.string().min(1), name: z.string().max(300) }))
    .min(1)
    .max(10),
});

export type CreateSheetResult = { error: string };

/** Creates the sheet from files the browser has already uploaded. Redirects to the sheet on success. */
export async function createSheetAction(
  input: z.input<typeof inputSchema>,
): Promise<CreateSheetResult> {
  const user = await requireUser();
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };
  const refusal = await demoAiRefusal(user.id);
  if (refusal) return { error: refusal };
  const { courseId, files } = parsed.data;

  try {
    await requireCourse(user.id, courseId);
  } catch (error) {
    if (error instanceof NotFoundError) return { error: "Course not found." };
    throw error;
  }

  if (!files.every((file) => keyIsUnder(file.key, user.id, "sheet", courseId))) {
    return { error: "Those files were not uploaded for this course." };
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

  const title = parsed.data.title.trim() || titleFromFileName(files[0].name);
  const sheet = await createSheetWithFiles(
    courseId,
    title,
    verified.map((file) => ({ path: file.key, mime: file.mime })),
  );
  // Reading the sheet takes a while, so it runs after the response is sent.
  after(() => runSheetPipeline(sheet.id));
  redirect(`/sheets/${sheet.id}`);
}
