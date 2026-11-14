"use server";

import { redirect } from "next/navigation";

import { CourseNameError, createCourse } from "@/db/queries/courses";
import { requireUser } from "@/lib/auth/session";

export type CreateCourseState = { error: string | null };

export async function createCourseAction(
  _previous: CreateCourseState,
  formData: FormData,
): Promise<CreateCourseState> {
  const user = await requireUser();

  let courseId: string;
  try {
    courseId = (await createCourse(user.id, String(formData.get("name") ?? ""))).id;
  } catch (error) {
    if (error instanceof CourseNameError) return { error: error.message };
    throw error;
  }
  redirect(`/courses/${courseId}/sheets`);
}
