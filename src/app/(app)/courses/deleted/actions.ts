"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";

import { restoreCourse, restoreSheet } from "@/db/queries/bin";
import { NotFoundError } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

const idSchema = z.string().min(1).max(100);

async function orNotFound(step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Restore: brings the course back with everything that went with it. */
export async function restoreCourseAction(courseId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(courseId);
  await orNotFound(() => restoreCourse(user.id, id));
  revalidatePath("/courses", "layout");
}

/** Restore: brings the sheet back with its questions, variants and history. */
export async function restoreSheetAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(sheetId);
  await orNotFound(() => restoreSheet(user.id, id));
  revalidatePath("/courses", "layout");
}
