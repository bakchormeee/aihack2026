"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { binCourse, binSheet } from "@/db/queries/bin";
import { NotFoundError } from "@/lib/auth/ownership";
import { requireUser } from "@/lib/auth/session";

const idSchema = z.string().min(1).max(100);

/** Runs a bin step; another user's id, a missing one or one already binned is the 404 page. */
async function orNotFound<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** "Delete course": moves it to the bin and opens the courses list with a notice. */
export async function deleteCourseAction(courseId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(courseId);
  await orNotFound(() => binCourse(user.id, id));
  revalidatePath("/courses");
  redirect("/courses?deleted=1");
}

/** "Delete sheet": moves it to the bin and opens its course with a notice. */
export async function deleteSheetAction(sheetId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(sheetId);
  const sheet = await orNotFound(() => binSheet(user.id, id));
  revalidatePath(`/courses/${sheet.courseId}`);
  redirect(`/courses/${sheet.courseId}?deleted=1`);
}
